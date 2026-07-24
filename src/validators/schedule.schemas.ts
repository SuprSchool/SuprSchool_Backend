import { z } from 'zod';

const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, {
    message: 'Use a valid calendar date',
  });

const monthSchema = z
  .string()
  .regex(/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM');

const yearSchema = z.string().regex(/^(?!0000)\d{4}$/, 'Use YYYY');

const attendanceHistoryCursorSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}\|[0-9a-f-]{36}$/i, 'Use a valid attendance history cursor')
  .refine((value) => {
    const [date, sessionId] = value.split('|');
    return date !== undefined
      && sessionId !== undefined
      && isoDateSchema.safeParse(date).success
      && z.uuid().safeParse(sessionId).success;
  }, { message: 'Use a valid attendance history cursor' });

export const timetableQuerySchema = z.object({ date: isoDateSchema });

export const studentAttendanceQuerySchema = z.discriminatedUnion('period', [
  z.object({ date: isoDateSchema, period: z.literal('daily') }),
  z.object({ month: monthSchema, period: z.literal('monthly') }),
  z.object({ period: z.literal('yearly'), year: yearSchema }),
]);

export const teacherAttendanceHistoryQuerySchema = z.object({
  classId: z.uuid(),
  cursor: attendanceHistoryCursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export type TimetableQuery = z.infer<typeof timetableQuerySchema>;
export type StudentAttendanceQuery = z.infer<typeof studentAttendanceQuerySchema>;
export type TeacherAttendanceHistoryQuery = z.infer<typeof teacherAttendanceHistoryQuerySchema>;
