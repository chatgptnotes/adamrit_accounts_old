-- Monthly lab-charges totals for the Director Dashboard expense matrix
-- ("Sys" value of the Lab charges row). Sums visit_labs.cost per month,
-- excluding soft-hidden rows.

CREATE OR REPLACE FUNCTION public.director_lab_charges_by_month(p_year integer)
RETURNS TABLE (month integer, total numeric)
LANGUAGE sql
STABLE
AS $$
  SELECT extract(month FROM created_at)::integer AS month,
         sum(cost) AS total
  FROM public.visit_labs
  WHERE created_at >= make_date(p_year, 1, 1)
    AND created_at < make_date(p_year + 1, 1, 1)
    AND coalesce(is_hidden, false) = false
  GROUP BY 1
  ORDER BY 1;
$$;

GRANT EXECUTE ON FUNCTION public.director_lab_charges_by_month(integer) TO anon;
GRANT EXECUTE ON FUNCTION public.director_lab_charges_by_month(integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
