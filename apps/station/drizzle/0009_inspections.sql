CREATE TABLE `inspections` (
	`id` text PRIMARY KEY NOT NULL,
	`deck_id` text NOT NULL,
	`crew_id` text NOT NULL,
	`flight` integer NOT NULL,
	`attempt` integer NOT NULL,
	`trigger` text NOT NULL,
	`state` text DEFAULT 'running' NOT NULL,
	`reason` text,
	`fingerprint` text NOT NULL,
	`commit` text NOT NULL,
	`findings` text DEFAULT '[]' NOT NULL,
	`brief_id` text,
	`started_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`deck_id`) REFERENCES `decks`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "inspections_state_check" CHECK(state in ('running', 'cleared', 'flagged', 'cancelled')),
	CONSTRAINT "inspections_trigger_check" CHECK(trigger in ('stop', 'manual'))
);
--> statement-breakpoint
CREATE INDEX `inspections_crew_idx` ON `inspections` (`crew_id`,`started_at`);--> statement-breakpoint
ALTER TABLE `decks` ADD `inspector` integer DEFAULT true NOT NULL;