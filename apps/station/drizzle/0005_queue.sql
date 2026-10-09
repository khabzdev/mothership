CREATE TABLE `queue_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`deck_id` text NOT NULL,
	`title` text NOT NULL,
	`prompt` text NOT NULL,
	`issue_number` integer,
	`state` text DEFAULT 'queued' NOT NULL,
	`crew_id` text,
	`crew_name` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`deck_id`) REFERENCES `decks`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "queue_tasks_state_check" CHECK(state in ('queued', 'running', 'done'))
);
--> statement-breakpoint
ALTER TABLE `decks` ADD `queue_limit` integer DEFAULT 3 NOT NULL;