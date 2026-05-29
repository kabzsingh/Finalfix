DO $$ BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.readings;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;
ALTER TABLE public.readings REPLICA IDENTITY FULL;