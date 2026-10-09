CREATE TABLE `console_labels` (
	`deck_id` text NOT NULL,
	`console_id` integer NOT NULL,
	`text` text NOT NULL,
	`color` text NOT NULL,
	PRIMARY KEY(`deck_id`, `console_id`),
	FOREIGN KEY (`deck_id`) REFERENCES `decks`(`id`) ON UPDATE no action ON DELETE cascade
);
