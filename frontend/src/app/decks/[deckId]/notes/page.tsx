"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import { AppShell, ErrorBanner } from "@/components/AppShell";
import {
  createNote,
  deleteNote,
  getDeck,
  listNotes,
  updateNote,
} from "@/lib/local/repo";
import type { CardRecord, DeckRecord, NoteRecord } from "@/lib/local/types";
import type { NoteType } from "@/lib/types";

const inputClass =
  "w-full rounded-md border border-black/15 bg-transparent px-3 py-2 text-sm outline-none focus:border-indigo-500 dark:border-white/20";

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
      <NotesManager />
    </AppShell>
  );
}

function NotesManager() {
  const params = useParams<{ deckId: string }>();
  const deckId = params.deckId;

  const [deck, setDeck] = useState<DeckRecord | null>(null);
  const [notes, setNotes] = useState<Array<{ note: NoteRecord; cards: CardRecord[] }> | null>(
    null,
  );
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [deckData, noteData] = await Promise.all([getDeck(deckId), listNotes(deckId)]);
      setDeck(deckData);
      setNotes(noteData);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nie udalo sie wczytac fiszek");
    }
  }, [deckId]);

  useEffect(() => {
    void load();
  }, [load]);

  function resetForm() {
    setDraft(EMPTY);
    setEditingId(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft.front.trim() || !draft.back.trim()) {
      setError("Przod i tyl fiszki nie moga byc puste");
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
      setError(caught instanceof Error ? caught.message : "Nie udalo sie zapisac fiszki");
    } finally {
      setBusy(false);
    }
  }

  async function remove(noteId: string) {
    if (!confirm("Usunac te fiszke? Historia powtorek zostanie zachowana.")) return;
    setError(null);
    try {
      await deleteNote(noteId);
      if (editingId === noteId) resetForm();
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nie udalo sie usunac fiszki");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <Link href="/" className="text-sm underline opacity-70 hover:opacity-100">
            ← Talie
          </Link>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">
            {deck?.name ?? "Fiszki"}
          </h1>
        </div>
        <Link
          href={`/decks/${deckId}/study`}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
        >
          Ucz sie
        </Link>
      </div>

      <form
        onSubmit={submit}
        className="space-y-3 rounded-lg border border-black/10 p-4 dark:border-white/15"
      >
        <h2 className="text-sm font-medium">
          {editingId ? "Edytuj fiszke" : "Nowa fiszka"}
        </h2>

        <label className="block space-y-1">
          <span className="text-sm">Przod</span>
          <textarea
            rows={2}
            value={draft.front}
            onChange={(e) => setDraft({ ...draft, front: e.target.value })}
            className={inputClass}
          />
        </label>

        <label className="block space-y-1">
          <span className="text-sm">Tyl</span>
          <textarea
            rows={2}
            value={draft.back}
            onChange={(e) => setDraft({ ...draft, back: e.target.value })}
            className={inputClass}
          />
        </label>

        <label className="block space-y-1">
          <span className="text-sm">
            Przyklad <span className="opacity-50">(opcjonalny, pokazywany z odpowiedzia)</span>
          </span>
          <textarea
            rows={2}
            value={draft.example}
            onChange={(e) => setDraft({ ...draft, example: e.target.value })}
            className={inputClass}
          />
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="text-sm">Tagi (po przecinku)</span>
            <input
              value={draft.tags}
              onChange={(e) => setDraft({ ...draft, tags: e.target.value })}
              className={inputClass}
            />
          </label>

          <label className="block space-y-1">
            <span className="text-sm">Typ</span>
            <select
              value={draft.noteType}
              onChange={(e) => setDraft({ ...draft, noteType: e.target.value as NoteType })}
              className={inputClass}
            >
              <option value="basic">Jednostronna (Przod → Tyl)</option>
              <option value="basic_reversed">Dwustronna (oba kierunki)</option>
            </select>
          </label>
        </div>

        <ErrorBanner message={error} />

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {editingId ? "Zapisz zmiany" : "Dodaj fiszke"}
          </button>
          {editingId && (
            <button
              type="button"
              onClick={resetForm}
              className="rounded-md border border-black/15 px-3 py-2 text-sm hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
            >
              Anuluj
            </button>
          )}
        </div>
      </form>

      <section className="space-y-2">
        <h2 className="text-sm font-medium opacity-70">
          Fiszki {notes ? `(${notes.length})` : ""}
        </h2>

        {notes === null ? (
          <p className="text-sm opacity-70">Wczytywanie…</p>
        ) : notes.length === 0 ? (
          <p className="text-sm opacity-70">Ta talia jest jeszcze pusta.</p>
        ) : (
          <ul className="space-y-2">
            {notes.map(({ note, cards }) => (
              <li
                key={note.id}
                className="rounded-lg border border-black/10 p-3 text-sm dark:border-white/15"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <p className="font-medium break-words">{note.fields.Front}</p>
                    <p className="opacity-70 break-words">{note.fields.Back}</p>
                    <p className="text-xs opacity-50">
                      {cards.length} {cards.length === 1 ? "karta" : "karty"}
                      {note.tags.length > 0 && ` · ${note.tags.join(", ")}`}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setDraft(toDraft(note));
                        setEditingId(note.id);
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      }}
                      className="rounded-md border border-black/15 px-2.5 py-1 hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
                    >
                      Edytuj
                    </button>
                    <button
                      type="button"
                      onClick={() => void remove(note.id)}
                      className="rounded-md border border-red-500/40 px-2.5 py-1 text-red-700 hover:bg-red-500/10 dark:text-red-300"
                    >
                      Usun
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
