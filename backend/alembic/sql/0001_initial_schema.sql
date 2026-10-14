CREATE TABLE admins (
  id            serial PRIMARY KEY,
  name          text NOT NULL,
  email         text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE exams (
  id             serial PRIMARY KEY,
  title          text NOT NULL,
  duration_min   int NOT NULL CHECK (duration_min BETWEEN 1 AND 600),
  instructions   text NOT NULL DEFAULT '',
  negative_marks numeric(5,2) NOT NULL DEFAULT 0 CHECK (negative_marks >= 0),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sections (
  id       serial PRIMARY KEY,
  exam_id  int NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  name     text NOT NULL,
  hint     text NOT NULL DEFAULT '',
  position int NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX sections_exam_name ON sections (exam_id, lower(name));

CREATE TABLE passages (
  id      serial PRIMARY KEY,
  exam_id int NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  title   text NOT NULL,
  body    text NOT NULL
);
CREATE UNIQUE INDEX passages_exam_title ON passages (exam_id, lower(title));

CREATE TABLE questions (
  id            serial PRIMARY KEY,
  exam_id       int NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  section_id    int NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  passage_id    int REFERENCES passages(id) ON DELETE SET NULL,
  position      int NOT NULL DEFAULT 0,
  text          text NOT NULL,
  options       jsonb NOT NULL,
  correct_index int NOT NULL,
  marks         numeric(6,2) NOT NULL DEFAULT 1 CHECK (marks > 0)
);
CREATE INDEX questions_exam ON questions (exam_id);

CREATE TABLE drives (
  id                    serial PRIMARY KEY,
  code                  text NOT NULL UNIQUE,
  name                  text NOT NULL,
  college               text NOT NULL,
  exam_id               int NOT NULL REFERENCES exams(id) ON DELETE RESTRICT,
  drive_date            date,
  opens_at              timestamptz,
  closes_at             timestamptz,
  is_open               boolean NOT NULL DEFAULT true,
  camera_required       boolean NOT NULL DEFAULT true,
  snapshot_interval_sec int NOT NULL DEFAULT 90 CHECK (snapshot_interval_sec BETWEEN 30 AND 600),
  require_fullscreen    boolean NOT NULL DEFAULT true,
  max_violations        int NOT NULL DEFAULT 3 CHECK (max_violations BETWEEN 0 AND 50),
  require_seb           boolean NOT NULL DEFAULT false,
  shuffle_questions     boolean NOT NULL DEFAULT true,
  shuffle_options       boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE students (
  id           serial PRIMARY KEY,
  drive_id     int NOT NULL REFERENCES drives(id) ON DELETE CASCADE,
  first_name   text NOT NULL,
  middle_name  text NOT NULL DEFAULT '',
  last_name    text NOT NULL,
  student_code text NOT NULL,
  email        text NOT NULL,
  phone        text NOT NULL,
  user_agent   text NOT NULL DEFAULT '',
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX students_drive_code  ON students (drive_id, lower(student_code));
CREATE UNIQUE INDEX students_drive_email ON students (drive_id, lower(email));
CREATE UNIQUE INDEX students_drive_phone ON students (drive_id, phone);

CREATE TABLE attempts (
  id             serial PRIMARY KEY,
  student_id     int NOT NULL UNIQUE REFERENCES students(id) ON DELETE CASCADE,
  token_hash     text NOT NULL UNIQUE,
  status         text NOT NULL DEFAULT 'registered' CHECK (status IN ('registered', 'in_progress', 'submitted')),
  question_order jsonb,
  option_orders  jsonb,
  started_at     timestamptz,
  ends_at        timestamptz,
  submitted_at   timestamptz,
  submit_reason  text,
  score          numeric(8,2),
  max_score      numeric(8,2),
  section_scores jsonb,
  violations     int NOT NULL DEFAULT 0,
  last_seen_at   timestamptz
);
CREATE INDEX attempts_in_progress ON attempts (ends_at) WHERE status = 'in_progress';

CREATE TABLE answers (
  attempt_id    int NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  question_id   int NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  selected      int,
  marked_review boolean NOT NULL DEFAULT false,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (attempt_id, question_id)
);

CREATE TABLE attempt_events (
  id         bigserial PRIMARY KEY,
  attempt_id int NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  type       text NOT NULL,
  detail     text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX attempt_events_attempt ON attempt_events (attempt_id);

CREATE TABLE snapshots (
  id         bigserial PRIMARY KEY,
  attempt_id int NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  image      bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX snapshots_attempt ON snapshots (attempt_id);

-- Moving a running test to another device needs a coordinator's approval.
ALTER TABLE attempts
  ADD COLUMN relogin_requested_at  timestamptz,  -- last time the student tried to continue on another device
  ADD COLUMN relogin_allowed_until timestamptz;  -- coordinator approval, valid once until this time

-- Results that HR publishes to students: shortlisted or not, with a message. No marks are shown.
ALTER TABLE drives
  ADD COLUMN results_published_at  timestamptz,               -- NULL = students cannot see results
  ADD COLUMN results_cutoff_pct    numeric(5,2),               -- shortlist at or above this percentage
  ADD COLUMN results_next_steps    text NOT NULL DEFAULT '',   -- shown to shortlisted students
  ADD COLUMN results_other_message text NOT NULL DEFAULT '';   -- shown to everyone else

ALTER TABLE attempts
  ADD COLUMN result_status text CHECK (result_status IN ('shortlisted', 'not_selected')),
  ADD COLUMN result_manual boolean NOT NULL DEFAULT false;     -- set by hand; publishing again keeps it
