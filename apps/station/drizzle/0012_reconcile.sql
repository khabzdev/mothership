ALTER TABLE `mission_prs` ADD `merged_at` integer;
--> statement-breakpoint
ALTER TABLE `mission_prs` ADD `closed_at` integer;
--> statement-breakpoint
UPDATE `mission_prs` SET `merged_at` = `opened_at` WHERE `merged_at` IS NULL;
