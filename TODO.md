# TODO

Nothing outstanding right now.

- Chip slider centering: fixed — `.chips` now gets a `.fits` class (centers
  the group, reduces side padding) when all chips fit without scrolling;
  `centerChip()` skips `scrollIntoView` in that case.
- Supabase backend migration: live and tested end to end (login -> editor ->
  save draft -> publish -> reflected on menu.html).
