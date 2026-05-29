-- Allow admins to insert/update/delete readings (for manual adjustments)
CREATE POLICY "admins insert readings"
ON public.readings
FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admins update readings"
ON public.readings
FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admins delete readings"
ON public.readings
FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));