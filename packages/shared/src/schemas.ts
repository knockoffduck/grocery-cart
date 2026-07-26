import { z } from 'zod';

export const PasswordSchema = z
  .string()
  .min(8, { message: 'Be at least 8 characters long' });

export const EmailSchema = z
  .string()
  .email({ message: 'Please enter a valid email.' })
  .trim();

export const LoginSchema = z.object({
  email: EmailSchema,
  password: z.string().min(1, { message: 'Required' }),
});

export const SignupSchema = z.object({
  email: EmailSchema,
  password: PasswordSchema,
  name: z.string().max(120).optional(),
});

export type LoginInput = z.infer<typeof LoginSchema>;
export type SignupInput = z.infer<typeof SignupSchema>;
