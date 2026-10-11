CREATE TABLE `missions` (
	`id` text PRIMARY KEY NOT NULL,
	`deck_id` text NOT NULL,
	`crew_id` text NOT NULL,
	`name` text NOT NULL,
	`task` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer NOT NULL,
	`how` text NOT NULL,
	`pr_url` text,
	`branch` text,
	FOREIGN KEY (`deck_id`) REFERENCES `decks`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "missions_how_check" CHECK(how in ('pr', 'home'))
);
--> statement-breakpoint
CREATE INDEX `missions_deck_idx` ON `missions` (`deck_id`,`ended_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `missions_crew_started_unique` ON `missions` (`crew_id`,`started_at`);--> statement-breakpoint
ALTER TABLE `lessons` ADD `mission_id` text;