-- Allow a submission that has no file.
--
-- Uploading work is optional for graded and non-graded assignments alike: a
-- student may hand in an assignment by declaring it done, with nothing
-- attached. `assignment_submissions_file_shape_check` (20260716020000) made
-- that unrepresentable — it required the whole file triple to be non-null
-- whenever `submitted_at` was set, so a fileless submission violated the check
-- and the write failed on device.
--
-- The real corruption the check exists to prevent is a PARTIAL triple: a row
-- naming an object path with no upload session, or an upload session with no
-- object. That is still rejected. What changes is that `submitted_at` is no
-- longer coupled to the file at all — a submission may carry a complete file or
-- no file, and the two remaining shapes are stated in terms of the triple
-- alone.
--
--   allowed  — no file at all      (draft, or a fileless submission)
--   allowed  — complete file triple, with submitted_at set
--   rejected — a partial triple    (1 or 2 of the three columns)
--   rejected — a complete triple with no submitted_at  (unchanged)

alter table public.assignment_submissions
  drop constraint if exists assignment_submissions_file_shape_check;

alter table public.assignment_submissions
  add constraint assignment_submissions_file_shape_check
  check (
    num_nonnulls(upload_session_id, object_path, display_name) = 0
    or (
      num_nonnulls(upload_session_id, object_path, display_name) = 3
      and submitted_at is not null
    )
  );

comment on constraint assignment_submissions_file_shape_check
  on public.assignment_submissions is
  'A submission carries a complete file triple or no file at all; a partial triple is corruption. submitted_at is independent of the file, so a student may submit with nothing attached.';
