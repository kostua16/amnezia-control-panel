-- AddColumn: Server.redirectIp — nullable, no default, so ALTER TABLE is accepted
-- even when "servers" already holds rows.
ALTER TABLE "servers" ADD COLUMN "redirectIp" TEXT;
