CREATE TABLE `lessons` (
	`id` text PRIMARY KEY NOT NULL,
	`deck_id` text NOT NULL,
	`text` text NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`from_name` text NOT NULL,
	`evidence` text DEFAULT '' NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`settled_at` integer,
	FOREIGN KEY (`deck_id`) REFERENCES `decks`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "lessons_state_check" CHECK(state in ('pending', 'kept', 'dropped', 'retired'))
);
--> statement-breakpoint
CREATE INDEX `lessons_deck_idx` ON `lessons` (`deck_id`,`state`);--> statement-breakpoint
CREATE TABLE `mission_prs` (
	`url` text PRIMARY KEY NOT NULL,
	`deck_id` text NOT NULL,
	`name` text NOT NULL,
	`branch` text,
	`opened_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`deck_id`) REFERENCES `decks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `service_records` (
	`deck_id` text NOT NULL,
	`name` text NOT NULL,
	`missions` integer DEFAULT 0 NOT NULL,
	`merged` integer DEFAULT 0 NOT NULL,
	`first_try_go` integer DEFAULT 0 NOT NULL,
	`first_try_clear` integer DEFAULT 0 NOT NULL,
	`clean_briefs` integer DEFAULT 0 NOT NULL,
	`lessons_kept` integer DEFAULT 0 NOT NULL,
	`patches` text DEFAULT '[]' NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	PRIMARY KEY(`deck_id`, `name`),
	FOREIGN KEY (`deck_id`) REFERENCES `decks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `crew` ADD `mission_since` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `crew` SET `mission_since` = `created_at`;--> statement-breakpoint
INSERT INTO `service_records` (`deck_id`, `name`, `clean_briefs`, `updated_at`) SELECT `deck_id`, `name`, SUM(`clean_briefs`), CAST(unixepoch('subsec') * 1000 AS integer) FROM `crew` WHERE `clean_briefs` > 0 GROUP BY `deck_id`, `name` ON CONFLICT(`deck_id`, `name`) DO UPDATE SET `clean_briefs` = `service_records`.`clean_briefs` + excluded.`clean_briefs`;
