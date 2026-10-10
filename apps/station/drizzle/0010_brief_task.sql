ALTER TABLE `briefs` ADD `task` text DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE `briefs` SET `task` = coalesce((SELECT `task` FROM `crew` WHERE `crew`.`id` = `briefs`.`crew_id`), '');
