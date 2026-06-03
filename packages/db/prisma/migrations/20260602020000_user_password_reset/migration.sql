-- fix(audit pentest-authn-6): password-reset support. Stores the SHA-256 hash of
-- the emailed reset token (never the raw token) + its expiry.
-- AlterTable
ALTER TABLE "User" ADD COLUMN "passwordResetTokenHash" TEXT;
ALTER TABLE "User" ADD COLUMN "passwordResetExpiry" TIMESTAMP(3);
