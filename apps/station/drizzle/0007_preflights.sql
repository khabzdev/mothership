CREATE TABLE `preflight_results` (
	`preflight_id` text NOT NULL,
	`check_id` text NOT NULL,
	`position` integer NOT NULL,
	`name` text NOT NULL,
	`command` text NOT NULL,
	`verdict` text NOT NULL,
	`exit_code` integer,
	`timed_out` integer NOT NULL,
	`duration_ms` integer NOT NULL,
	`tail` text NOT NULL,
	PRIMARY KEY(`preflight_id`, `position`),
	FOREIGN KEY (`preflight_id`) REFERENCES `preflights`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "preflight_results_verdict_check" CHECK(verdict in ('go', 'nogo', 'skipped'))
);
--> statement-breakpoint
CREATE TABLE `preflights` (
	`id` text PRIMARY KEY NOT NULL,
	`deck_id` text NOT NULL,
	`crew_id` text NOT NULL,
	`flight` integer NOT NULL,
	`attempt` integer NOT NULL,
	`state` text DEFAULT 'running' NOT NULL,
	`trigger` text NOT NULL,
	`commit` text NOT NULL,
	`fingerprint` text NOT NULL,
	`started_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`deck_id`) REFERENCES `decks`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "preflights_state_check" CHECK(state in ('running', 'go', 'nogo', 'cancelled')),
	CONSTRAINT "preflights_trigger_check" CHECK(trigger in ('stop', 'manual'))
);
--> statement-breakpoint
CREATE INDEX `preflights_crew_idx` ON `preflights` (`crew_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `preflights_deck_idx` ON `preflights` (`deck_id`,`started_at`);--> statement-breakpoint
ALTER TABLE `crew` ADD `flight` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `crew` ADD `fuel` integer DEFAULT 3 NOT NULL;