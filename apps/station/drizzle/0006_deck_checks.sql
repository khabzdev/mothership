CREATE TABLE `deck_checks` (
	`id` text PRIMARY KEY NOT NULL,
	`deck_id` text NOT NULL,
	`name` text NOT NULL,
	`command` text NOT NULL,
	`timeout_ms` integer DEFAULT 300000 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`position` integer NOT NULL,
	FOREIGN KEY (`deck_id`) REFERENCES `decks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `decks` ADD `checks_armed` integer;