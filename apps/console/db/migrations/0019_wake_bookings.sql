CREATE TABLE "wake_bookings" (
	"at" timestamp with time zone PRIMARY KEY NOT NULL,
	"booked_at" timestamp with time zone DEFAULT now() NOT NULL
);
