CREATE TABLE feedback_report (
  id uuid PRIMARY KEY,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('bug', 'feature')),
  title text NOT NULL,
  description text NOT NULL,
  area text,
  context text,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'reviewing', 'resolved')),
  created_at timestamptz NOT NULL DEFAULT now(),
  canny_link text,
  github_link text
);

CREATE INDEX feedback_report_user_created_idx ON feedback_report (user_id, created_at);
CREATE INDEX feedback_report_created_idx ON feedback_report (created_at, id);
