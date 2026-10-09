CREATE TABLE `crew` (
	`id` text PRIMARY KEY NOT NULL,
	`deck_id` text NOT NULL,
	`console_id` integer NOT NULL,
	`name` text NOT NULL,
	`color` text NOT NULL,
	`character` text NOT NULL,
	`provider` text DEFAULT 'claude-code' NOT NULL,
	`task` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'starting' NOT NULL,
	`action` text,
	`detail` text,
	`status_since` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`cwd` text NOT NULL,
	`branch` text,
	`pr_url` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`deck_id`) REFERENCES `decks`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "crew_status_check" CHECK(status in ('starting', 'idle', 'working', 'needs_input', 'done', 'asleep')),
	CONSTRAINT "crew_action_check" CHECK(action is null or action in ('read', 'edit', 'test', 'web', 'failing'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `crew_deck_console_unique` ON `crew` (`deck_id`,`console_id`);