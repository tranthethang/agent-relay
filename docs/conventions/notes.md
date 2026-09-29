## Notes

- Put each run at `.agent-relay/{YMD}-{RUN_ID}-{RUN_SLUG}/`.
- Commit `.agent-relay/` if you want the notes on the branch. Otherwise add
  the directory to `.gitignore`. This repo does not choose for you.
  `bin/install.sh` prints that reminder.
- Id generation: `RUN_ID` is generated offline via `date +%s` (Unix epoch
  seconds). No npm or network required.
