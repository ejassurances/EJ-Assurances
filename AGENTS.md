<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Keep type declarations for committed but unapplied migrations in `pending-schema-client.ts`, scoped to their callers; never edit generated database types or apply schema changes merely to repair compilation.

- Remuneration forecasts use the pure remuneration calculator and an atomic SQL recalculation RPC with database triggers; only forecast rows and their history may change, never recorded payments.
- Optional loan imports use separate document readings, an allowlisted financial DTO and explicit human confirmation; preserve document provenance outside the strict borrower recueil schema.
- Loan confirmation and reload share the pure import mapping and persistence payload; refresh mounted forms without overwriting pending human edits, and use an updated-at guard for server confirmation to prevent stale writes.
