"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState, type FormEvent } from "react";

import {
  AppShell,
  ErrorBanner,
  buttonClass,
  inputClass,
  secondaryButtonClass,
} from "@/components/AppShell";
import { createNote, deleteNote, getDeck, listNotes, updateNote, setNoteSuspended } from "@/lib/local/repo";
import type { CardRecord, DeckRecord, NoteRecord } from "@/lib/local/types";
import { odmien, type NoteType } from "@/lib/types";

interface Draft {
  front: string;
  back: string;
  example: string;
  tags: string;
  noteType: NoteType;
}

const EMPTY: Draft = { front: "", back: "", example: "", tags: "", noteType: "basic" };

function toDraft(note: NoteRecord): Draft {
  return {
    front: note.fields.Front ?? "",
    back: note.fields.Back ?? "",
    example: note.fields.Example ?? "",
    tags: note.tags.join(", "),
    noteType: note.noteType,
  };
}

function parseTags(value: string): string[] {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export default function NotesPage() {
  return (
    <AppShell>
      <Suspense fallback={<p className="text-sm text-ink-2">Wczytywanie…</p>}>
        <NotesManager />
      </Suspense>
    </AppShell>
  );
}

function NotesManager() {
  const deckId = useSearchParams().get("talia") ?? "";

  const [deck, setDeck] = useState<DeckRecord | null>(null);
  const [notes, setNotes] = useState<Array<{ note: NoteRecord; cards: CardRecord[] }> | null>(
    null,
  );
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  //: Przy kilkuset fiszkach przewijanie listy przestaje byc wyszukiwaniem.
  const [szukaj, setSzukaj] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!deckId) {
      setError("Brak talii w adresie");
      return;
    }
    try {
      const [deckData, noteData] = await Promise.all([getDeck(deckId), listNotes(deckId)]);
      setDeck(deckData);
      setNotes(noteData);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nie udało się wczytać fiszek");
    }
  }, [deckId]);

  useEffect(() => {
    // Stan pochodzi z IndexedDB, wiec zapis nastepuje po await, nie w ciele
    // efektu; regula tego nie rozroznia.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  function resetForm() {
    setDraft(EMPTY);
    setEditingId(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft.front.trim() || !draft.back.trim()) {
      setError("Przód i tył fiszki nie mogą być puste");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const fields = {
        Front: draft.front.trim(),
        Back: draft.back.trim(),
        Example: draft.example.trim(),
      };
      const tags = parseTags(draft.tags);
      if (editingId) {
        await updateNote(editingId, { fields, tags, noteType: draft.noteType });
      } else {
        await createNote({ deckId, noteType: draft.noteType, fields, tags });
      }
      resetForm();
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nie udało się zapisać fiszki");
    } finally {
      setBusy(false);
    }
  }

  async function przywroc(noteId: string) {
    setError(null);
    try {
      await setNoteSuspended(noteId, false);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nie udało się przywrócić fiszki");
    }
  }

  //: Szukamy po wszystkim, co widac na fiszce - tak samo jak czlowiek
  //: szukajacy "tego slowka o obchodzie".
  const widoczne = (notes ?? []).filter(({ note }) => {
    const fraza = szukaj.trim().toLowerCase();
    if (!fraza) return true;
    return [note.fields.Front, note.fields.Back, note.fields.Example ?? "", ...note.tags]
      .join(" ")
      .toLowerCase()
      .includes(fraza);
  });

  async function remove(noteId: string) {
    if (!confirm("Usunąć tę fiszkę? Historia powtórek zostanie zachowana.")) return;
    setError(null);
    try {
      await deleteNote(noteId);
      if (editingId === noteId) resetForm();
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nie udało się usunąć fiszki");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/" aria-label="Wróć do talii" className="text-ink-3 hover:text-ink-2">
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold tracking-[-0.01em]">
            {deck?.name ?? "Fiszki"}
          </h1>
          {notes && (
            <p className="text-xs text-ink-3">
              {notes.length} {odmien(notes.length, "fiszka", "fiszki", "fiszek")}
            </p>
          )}
        </div>
        <Link
          href={`/nauka?talia=${deckId}`}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:bg-accent-hover"
        >
          Ucz się
        </Link>
      </div>

      <form
        onSubmit={submit}
        className="space-y-2.5 rounded-xl border border-line bg-surface p-4"
      >
        <p className="text-[13px] font-medium text-ink-2">
          {editingId ? "Edytuj fiszkę" : "Nowa fiszka"}
        </p>

        <textarea
          rows={2}
          value={draft.front}
          onChange={(e) => setDraft({ ...draft, front: e.target.value })}
          placeholder="przód fiszki"
          className={`${inputClass} tresc text-[15px]`}
        />
        <textarea
          rows={2}
          value={draft.back}
          onChange={(e) => setDraft({ ...draft, back: e.target.value })}
          placeholder="tył fiszki"
          className={`${inputClass} tresc text-[15px]`}
        />
        <textarea
          rows={2}
          value={draft.example}
          onChange={(e) => setDraft({ ...draft, example: e.target.value })}
          placeholder="przykład (opcjonalnie)"
          className={`${inputClass} text-[13px]`}
        />

        <div className="grid gap-2 sm:grid-cols-2">
          <input
            value={draft.tags}
            onChange={(e) => setDraft({ ...draft, tags: e.target.value })}
            placeholder="tagi (po przecinku)"
            className={`${inputClass} text-[13px]`}
          />
          <select
            value={draft.noteType}
            onChange={(e) => setDraft({ ...draft, noteType: e.target.value as NoteType })}
            className={`${inputClass} text-[13px]`}
          >
            <option value="basic">Jednostronna</option>
            <option value="basic_reversed">Dwustronna (oba kierunki)</option>
          </select>
        </div>

        <ErrorBanner message={error} />

        <div className="flex gap-2 pt-0.5">
          <button type="submit" disabled={busy} className={`${buttonClass} flex-1`}>
            {editingId ? "Zapisz zmiany" : "Dodaj fiszkę"}
          </button>
          {editingId && (
            <button type="button" onClick={resetForm} className={secondaryButtonClass}>
              Anuluj
            </button>
          )}
        </div>
      </form>

      <section>
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <p className="text-xs tracking-[0.01em] text-ink-3">
            {szukaj.trim() ? "ZNALEZIONE" : "OSTATNIO DODANE"}
          </p>
          {notes !== null && notes.length > 0 && (
            <span className="text-xs tabular-nums text-ink-4">
              {widoczne.length} / {notes.length}
            </span>
          )}
        </div>

        {notes !== null && notes.length > 8 && (
          <input
            type="search"
            value={szukaj}
            onChange={(e) => setSzukaj(e.target.value)}
            placeholder="Szukaj w przodzie, tyle, przykładzie i tagach…"
            className={`${inputClass} mb-3`}
          />
        )}

        {notes === null ? (
          <p className="text-sm text-ink-2">Wczytywanie…</p>
        ) : notes.length === 0 ? (
          <p className="text-sm text-ink-2">Ta talia jest jeszcze pusta.</p>
        ) : widoczne.length === 0 ? (
          <p className="text-sm text-ink-2">Nic nie pasuje do „{szukaj.trim()}”.</p>
        ) : (
          <ul>
            {widoczne.map(({ note, cards }, i) => (
              <li
                key={note.id}
                className={`py-3.5 ${i < widoczne.length - 1 ? "border-b border-line-soft" : ""}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="tresc break-words text-base">{note.fields.Front}</p>
                    <p className="mt-1 break-words text-sm text-ink-2">{note.fields.Back}</p>
                    <p className="mt-1.5 text-xs text-ink-4">
                      {cards.length} {odmien(cards.length, "karta", "karty", "kart")}
                      {note.tags.length > 0 && ` · ${note.tags.join(", ")}`}
                    </p>
                    {cards.length > 0 && cards.every((c) => c.suspended) && (
                      <button
                        type="button"
                        onClick={() => void przywroc(note.id)}
                        className="mt-1.5 rounded bg-chip px-2 py-1 text-[11px] text-ink-3 hover:text-ink"
                      >
                        odłożona — przywróć
                      </button>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      aria-label="Edytuj"
                      onClick={() => {
                        setDraft(toDraft(note));
                        setEditingId(note.id);
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      }}
                      className="rounded-lg p-2 text-ink-3 hover:bg-chip hover:text-ink"
                    >
                      <svg
                        width="17"
                        height="17"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      aria-label="Usuń"
                      onClick={() => void remove(note.id)}
                      className="rounded-lg p-2 text-ink-3 hover:bg-again-bg hover:text-again"
                    >
                      <svg
                        width="17"
                        height="17"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                      </svg>
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
