-- CreateTable
CREATE TABLE "Foo"
(
    "id" SERIAL NOT NULL,
    CONSTRAINT "Foo_pkey" PRIMARY KEY ("id")
);

-- this trigger always fails
CREATE
OR REPLACE FUNCTION constraint_trigger_function() RETURNS TRIGGER AS $$
BEGIN
        RAISE
EXCEPTION 'Foo cannot be created!';
RETURN NEW;
END;
$$
LANGUAGE PLPGSQL;

-- add the "CONSTRAINT TRIGGER" deferred until the end of the database transaction
CREATE
CONSTRAINT TRIGGER constraint_trigger
    AFTER INSERT ON "Foo"
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE PROCEDURE constraint_trigger_function();