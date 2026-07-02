-- Copy Hope hospital surgeons and consultants data to Ayushman hospital tables
-- This migration duplicates all Hope medical staff data to Ayushman for data sharing

-- ========================================
-- COPY HOPE SURGEONS TO AYUSHMAN SURGEONS
-- ========================================

-- Insert all Hope surgeons data into Ayushman surgeons table
-- Only copy columns that exist in both tables
INSERT INTO public.ayushman_surgeons (
    name,
    specialty,
    department,
    contact_info
)
SELECT
    name,
    specialty,
    department,
    contact_info
FROM public.hope_surgeons;

-- Add comment with record count verification
DO $$
DECLARE
    hope_count INTEGER;
    ayushman_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO hope_count FROM public.hope_surgeons;
    SELECT COUNT(*) INTO ayushman_count FROM public.ayushman_surgeons;

    RAISE NOTICE 'Copied % Hope surgeons. Ayushman surgeons table now has % total records.',
        hope_count, ayushman_count;
END $$;

-- ============================================
-- COPY HOPE CONSULTANTS TO AYUSHMAN CONSULTANTS
-- ============================================

-- Insert all Hope consultants data into Ayushman consultants table
-- Only copy columns that exist in both tables
INSERT INTO public.ayushman_consultants (
    name,
    specialty,
    department,
    contact_info
)
SELECT
    name,
    specialty,
    department,
    contact_info
FROM public.hope_consultants;

-- Add comment with record count verification
DO $$
DECLARE
    hope_count INTEGER;
    ayushman_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO hope_count FROM public.hope_consultants;
    SELECT COUNT(*) INTO ayushman_count FROM public.ayushman_consultants;

    RAISE NOTICE 'Copied % Hope consultants. Ayushman consultants table now has % total records.',
        hope_count, ayushman_count;
END $$;

-- ============================================
-- FINAL VERIFICATION AND COMMENTS
-- ============================================

-- Add final summary
DO $$
DECLARE
    total_surgeons INTEGER;
    total_consultants INTEGER;
BEGIN
    SELECT COUNT(*) INTO total_surgeons FROM public.ayushman_surgeons;
    SELECT COUNT(*) INTO total_consultants FROM public.ayushman_consultants;

    RAISE NOTICE '=== DATA COPY COMPLETED ===';
    RAISE NOTICE 'Total Ayushman surgeons: %', total_surgeons;
    RAISE NOTICE 'Total Ayushman consultants: %', total_consultants;
    RAISE NOTICE 'All Hope hospital medical staff data has been successfully copied to Ayushman hospital tables.';
END $$;

-- Add table comments for documentation
COMMENT ON TABLE public.ayushman_surgeons IS 'Ayushman hospital surgeons - includes data copied from Hope hospital';
COMMENT ON TABLE public.ayushman_consultants IS 'Ayushman hospital consultants - includes data copied from Hope hospital';