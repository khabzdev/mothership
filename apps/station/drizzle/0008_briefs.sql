CREATE TABLE `briefs` (
	`id` text PRIMARY KEY NOT NULL,
	`deck_id` text NOT NULL,
	`crew_id` text NOT NULL,
	`revision` integer NOT NULL,
	`text` text NOT NULL,
	`state` text DEFAULT 'waiting' NOT NULL,
	`approved_by` text,
	`reason` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`settled_at` integer,
	FOREIGN KEY (`deck_id`) REFERENCES `decks`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "briefs_state_check" CHECK(state in ('waiting', 'approved', 'revised', 'superseded')),
	CONSTRAINT "briefs_approved_by_check" CHECK(approved_by in ('you', 'terminal'))
);
--> statement-breakpoint
CREATE INDEX `briefs_crew_idx` ON `briefs` (`crew_id`,`revision`);--> statement-breakpoint
ALTER TABLE `crew` ADD `clean_briefs` integer DEFAULT 0 NOT NULL;