CREATE TABLE `criteria` (
	`id` text PRIMARY KEY NOT NULL,
	`mission_id` text NOT NULL,
	`position` integer NOT NULL,
	`kind` text NOT NULL,
	`command` text,
	`label` text,
	FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "criteria_kind_check" CHECK(kind in ('command', 'manual'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `criteria_mission_position_unique` ON `criteria` (`mission_id`,`position`);--> statement-breakpoint
CREATE TABLE `decks` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`repo_path` text NOT NULL,
	`modules` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `decks_repo_path_unique` ON `decks` (`repo_path`);--> statement-breakpoint
CREATE TABLE `missions` (
	`id` text PRIMARY KEY NOT NULL,
	`deck_id` text NOT NULL,
	`goal` text NOT NULL,
	`state` text DEFAULT 'briefing' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 3 NOT NULL,
	`alert` text,
	`resume_to` text,
	`pr_url` text,
	`branch` text,
	`worktree_path` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`deck_id`) REFERENCES `decks`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "missions_state_check" CHECK(state in ('briefing', 'building', 'preflight', 'launching', 'launched', 'redAlert')),
	CONSTRAINT "missions_resume_to_check" CHECK(resume_to is null or resume_to in ('briefing', 'building', 'preflight', 'launching', 'launched', 'redAlert'))
);
--> statement-breakpoint
CREATE INDEX `missions_deck_idx` ON `missions` (`deck_id`);--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`mission_id` text NOT NULL,
	`criterion_id` text NOT NULL,
	`attempt` integer NOT NULL,
	`verdict` text NOT NULL,
	`output` text,
	`duration_ms` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`criterion_id`) REFERENCES `criteria`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "runs_verdict_check" CHECK(verdict in ('go', 'nogo'))
);
--> statement-breakpoint
CREATE INDEX `runs_mission_attempt_idx` ON `runs` (`mission_id`,`attempt`);