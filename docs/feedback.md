# FitnessTrackr feedback

Members can open **Settings → Report a bug** to report an issue or request a feature. The page shows the member’s ten latest submissions and their status. Signed-out visitors can reach support by email. The app owner can review all reports from **Support → Feedback inbox**. The existing deployment migration command applies `024-feedback.sql`.

The inbox works with the existing account and database. Add provider credentials only to the server environment to enable the optional handoffs. The owner writes the title and summary that will be shared. The original report, account email and device context stay in FitnessTrackr.

## Canny

Create a private **FitnessTrackr Feedback** board in [Canny board settings](https://help.canny.io/en/articles/4968514-board-settings). Set these environment variables:

- `CANNY_API_KEY` — the workspace API key.
- `CANNY_FEEDBACK_BOARD_ID` — the board’s ID from the [Canny Boards API](https://developers.canny.io/api-reference#list-all-boards).
- `CANNY_FEEDBACK_AUTHOR_ID` — the Canny ID of the owner or service user that authors the posts. Use the [Canny user API](https://developers.canny.io/api-reference#retrieve-user) to look it up.

**Send to Canny** checks the board’s privacy, creates a post and links it in the report. Keep the board private. Canny post status is maintained in Canny. FitnessTrackr’s owner sets the status shown to the reporter.

## AI fix proposal

Enable Copilot cloud agent in the private `varmi5/fitness-tracker` repository and set `FEEDBACK_GITHUB_TOKEN` to a user token scoped to that repository. Follow GitHub’s [cloud agent API permissions](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/use-cloud-agent-via-the-api#using-the-issues-api) for a fine-grained token.

**Ask AI to propose a fix** creates a GitHub issue and requests Copilot assignment. Follow the issue to the draft PR, review its diff and run checks before merging. The button does not merge the PR or deploy code. If GitHub accepts the issue but skips assignment, open the linked issue and assign Copilot there.

Each handoff stores the issue or post link. If delivery is unconfirmed, search the destination for the report’s full reference before creating another issue or post. The pending marker prevents repeated clicks or a server restart from sending duplicates.
