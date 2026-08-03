"""Sprawdza caly cykl end-to-end na dzialajacym backendzie.

    python scripts/smoke_e2e.py

Rejestracja -> talia -> fiszka -> kolejka -> ocena -> ponowna kolejka.
Nie dotyka bazy bezposrednio; jedzie po HTTP jak prawdziwy klient.
"""

import os
import sys
import uuid

import httpx

BASE = os.environ.get("SMOKE_BASE_URL", "http://localhost:8000/api")
INVITE = os.environ.get("INVITE_CODE", "rodzina")

email = f"smoke-{uuid.uuid4().hex[:8]}@example.test"
password = "haslo-testowe-123"


def main() -> int:
    with httpx.Client(base_url=BASE, timeout=15.0) as client:
        health = client.get("/health")
        health.raise_for_status()
        print(f"health: {health.json()}")

        registered = client.post(
            "/auth/register",
            json={
                "email": email,
                "password": password,
                "display_name": "Smoke Test",
                "invite_code": INVITE,
            },
        )
        if registered.status_code == 403:
            print("BLAD: nieprawidlowy kod zaproszenia. Ustaw INVITE_CODE zgodnie z backend/.env")
            return 1
        registered.raise_for_status()
        token = registered.json()["access_token"]
        client.headers["Authorization"] = f"Bearer {token}"
        print(f"rejestracja: {email}")

        decks = client.get("/decks")
        decks.raise_for_status()
        deck = decks.json()[0]
        print(f"talia startowa: {deck['name']} (karty: {deck['counts']['total']})")

        note = client.post(
            "/notes",
            json={
                "deck_id": deck["id"],
                "note_type": "basic_reversed",
                "fields": {"Front": "kot", "Back": "cat"},
                "tags": ["smoke", "angielski"],
            },
        )
        note.raise_for_status()
        cards = note.json()["cards"]
        print(f"notatka dwustronna -> wygenerowane karty: {len(cards)} "
              f"({', '.join(c['template_label'] for c in cards)})")
        assert len(cards) == 2, "notatka dwustronna powinna dac 2 karty"

        queue = client.get("/study/queue", params={"deck_id": deck["id"]})
        queue.raise_for_status()
        data = queue.json()
        print(f"kolejka: {len(data['cards'])} kart, nowych {data['new_remaining']}")
        assert data["cards"], "kolejka nie powinna byc pusta"

        first = data["cards"][0]
        print(f"  pytanie: {first['question']!r} -> odpowiedz: {first['answer']!r}")
        if first.get("example"):
            print(f"  przyklad: {first['example']!r}")
        print(f"  podglad interwalow: {first['interval_preview']}")

        event_id = str(uuid.uuid4())
        review = client.post(
            "/study/review",
            json={
                "card_id": first["card_id"],
                "rating": 3,
                "client_event_id": event_id,
                "duration_ms": 4200,
            },
        )
        review.raise_for_status()
        result = review.json()
        print(f"ocena 'Dobre': nastepna powtorka za {result['scheduled_label']} "
              f"(state={result['state']}, reps={result['reps']})")

        # Ta sama ocena jeszcze raz - musi zostac rozpoznana jako duplikat.
        again = client.post(
            "/study/review",
            json={
                "card_id": first["card_id"],
                "rating": 3,
                "client_event_id": event_id,
                "duration_ms": 4200,
            },
        )
        again.raise_for_status()
        assert again.json()["duplicate"] is True, "powtorne wyslanie powinno byc idempotentne"
        assert again.json()["reps"] == result["reps"], "duplikat nie moze zwiekszyc licznika"
        print("idempotencja: powtorne wyslanie tego samego zdarzenia nie zdublowalo powtorki")

        after = client.get("/study/queue", params={"deck_id": deck["id"]}).json()
        print(f"kolejka po ocenie: {len(after['cards'])} kart")

        # --- import ---------------------------------------------------------
        csv_data = (
            "Term;Definition;Example;Tags\n"
            "ubiquitous;wszechobecny;Smartphones are ubiquitous.;b2,przymiotnik\n"
            "kick the bucket;kopnąć w kalendarz;;idiom\n"
            "Czy mogę prosić o rachunek?;Could I have the bill, please?;;podroze\n"
            "kot;cat;;zwierzeta\n"
        ).encode("utf-8")

        analyzed = client.post(
            "/import/analyze",
            files={"file": ("talia.csv", csv_data, "text/csv")},
        )
        analyzed.raise_for_status()
        job = analyzed.json()
        print(f"\nimport: wykryto format '{job['source_format']}', kolumny {job['columns']}")
        print(f"  sugerowane mapowanie: {job['suggested_mapping']}")
        print(f"  duplikaty: {job['duplicates']}")
        for warning in job["warnings"]:
            print(f"  uwaga: {warning}")
        for item in job["preview"][:4]:
            print(f"  -> [{item['item_kind']:9}] {item['fields'].get('Front')}")

        # Kategorie musza byc rozpoznane, bo na nich opieraja sie statystyki.
        kinds = {item["fields"]["Front"]: item["item_kind"] for item in job["preview"]}
        assert kinds["ubiquitous"] == "word", kinds
        assert kinds["kick the bucket"] == "phrase", kinds
        assert kinds["Czy mogę prosić o rachunek?"] == "sentence", kinds

        committed = client.post(
            f"/import/{job['job_id']}/commit",
            json={
                "deck_id": deck["id"],
                "mapping": job["suggested_mapping"],
                "note_type": "basic",
                "skip_duplicates": True,
            },
        )
        committed.raise_for_status()
        summary = committed.json()
        print(f"  zaimportowano {summary['imported']}, pominieto duplikatow "
              f"{summary['skipped_duplicates']}")
        assert summary["imported"] == 4, summary

        # Ten sam plik jeszcze raz - deduplikacja po tresci ma go odrzucic.
        again_job = client.post(
            "/import/analyze", files={"file": ("talia.csv", csv_data, "text/csv")}
        ).json()
        assert again_job["duplicates"]["already_in_collection"] == 4, again_job["duplicates"]
        repeat = client.post(
            f"/import/{again_job['job_id']}/commit",
            json={"deck_id": deck["id"], "mapping": again_job["suggested_mapping"]},
        ).json()
        assert repeat["imported"] == 0 and repeat["skipped_duplicates"] == 4, repeat
        print("  ponowny import tego samego pliku: 0 nowych, 4 pominiete (deduplikacja dziala)")

        # --- statystyki -----------------------------------------------------
        overview = client.get("/stats/overview", params={"days": 30})
        overview.raise_for_status()
        stats = overview.json()
        print(f"\nstatystyki: {stats['reviews']} powtorek, passa {stats['streak_days']} dni, "
              f"skutecznosc {stats['retention']} (probka {stats['retention_sample']})")

        by_kind = client.get("/stats/by-item-kind")
        by_kind.raise_for_status()
        print("  podzial na kategorie materialu:")
        for row in by_kind.json():
            print(f"    {row['item_kind']:11} kart: {row['cards']:3}  nowych: {row['new_cards']:3}  "
                  f"powtorek: {row['reviews']:3}  skutecznosc: {row['retention']}")

        forecast = client.get("/stats/forecast", params={"days": 14})
        forecast.raise_for_status()
        print(f"  prognoza na 14 dni: {forecast.json()}")

        client.get("/stats/leeches").raise_for_status()

        client.post("/auth/logout")
        print("\nSMOKE E2E OK")
        return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except httpx.ConnectError:
        print(f"BLAD: nie moge polaczyc sie z {BASE}. Czy backend dziala?")
        sys.exit(1)
    except httpx.HTTPStatusError as exc:
        print(f"BLAD {exc.response.status_code} na {exc.request.url}: {exc.response.text}")
        sys.exit(1)
