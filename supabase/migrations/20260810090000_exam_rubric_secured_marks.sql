-- 20260810090000_exam_rubric_secured_marks.sql
--
-- Per-section secured marks for a student's exam result. Figma 253:8504 prints
-- each grading-rubric section as secured/total -- "20/25 Marks", "8/10 Marks",
-- "4/5 Marks" -- and no column anywhere held the secured half.
--
-- The task brief sketched `alter table public.exam_rubric_items add column
-- secured_marks numeric`. There is no `exam_rubric_items` table. The real
-- rubric table is public.exam_rubrics, and it is keyed (assessment_id,
-- position): it holds the assessment's rubric DEFINITION -- one row per
-- section, shared by the whole class. Secured marks are per student, so a
-- column there would show one student's section score to every other student
-- in the class. That is the wrong home.
--
-- The per-student row is public.exam_results (unique on assessment_id,
-- student_id). The breakdown lands there as jsonb keyed by the rubric's
-- position -- the brief's "extend the json shape instead" path -- so the
-- cardinality is right and no new table, RLS policy or grant is introduced.
--
-- Nothing writes this column yet. The grading write path (upsertResultSchema)
-- captures a single total mark plus optional feedback and has no per-section
-- input, so `securedMarks` reads as null until evaluation records it and the
-- client keeps its section-hidden fallback. The column exists so the read
-- contract's shape lands once.
--
-- HAZARD for whoever writes it: the keys are exam_rubrics.position, which the
-- teacher can re-order or delete after a breakdown has been recorded. Nothing
-- re-keys this jsonb when that happens, so a stored breakdown silently
-- re-attaches to the wrong sections. The writer must re-key it on every rubric
-- edit, or the breakdown should move to a child table with a real foreign key
-- to exam_rubrics.id.

alter table public.exam_results
  add column if not exists rubric_secured_marks jsonb
    constraint exam_results_rubric_secured_marks_check
    check (rubric_secured_marks is null or jsonb_typeof(rubric_secured_marks) = 'object');

comment on column public.exam_results.rubric_secured_marks is
  'Per-section secured marks for this student''s result, keyed by exam_rubrics.position (e.g. {"1": 20, "2": 8}). Figma 253:8504 prints 20/25. Null until evaluation records it.';
