-- Add more comprehensive test data for age and gender-specific ranges

INSERT INTO lab_test_config (test_name, sub_test_name, min_age, max_age, gender, min_value, max_value, normal_unit)
VALUES
    -- yyy Test with more comprehensive ranges
    ('yyy', 'test1', 18, 45, 'Male', 3.9, 6.5, 'g/dl'),
    ('yyy', 'test1', 18, 45, 'Female', 2.9, 5.5, 'g/dl'),
    ('yyy', 'test1', 46, 65, 'Male', 4.2, 7.0, 'g/dl'),
    ('yyy', 'test1', 46, 65, 'Female', 3.2, 6.0, 'g/dl'),
    ('yyy', 'test1', 66, 100, 'Male', 4.5, 7.5, 'g/dl'),
    ('yyy', 'test1', 66, 100, 'Female', 3.5, 6.5, 'g/dl'),
    ('yyy', 'test1', 1, 17, 'Both', 2.0, 4.0, 'g/dl'),

    -- Add more sub-tests for yyy with different ranges
    ('yyy', 'test2', 18, 100, 'Male', 5.0, 8.0, 'mg/dl'),
    ('yyy', 'test2', 18, 100, 'Female', 4.5, 7.5, 'mg/dl'),
    ('yyy', 'test2', 1, 17, 'Both', 3.0, 6.0, 'mg/dl'),

    -- Add ranges for RR that are gender and age specific
    ('yyy', 'RR', 18, 45, 'Male', 17.0, 21.0, 'g/dl'),
    ('yyy', 'RR', 18, 45, 'Female', 15.0, 19.0, 'g/dl'),
    ('yyy', 'RR', 46, 100, 'Male', 16.5, 20.5, 'g/dl'),
    ('yyy', 'RR', 46, 100, 'Female', 14.5, 18.5, 'g/dl'),
    ('yyy', 'RR', 1, 17, 'Both', 12.0, 16.0, 'g/dl'),

    -- Update RRR with more specific ranges
    ('yyy', 'RRR', 18, 45, 'Both', 16.5, 20.5, 'g/dl'),
    ('yyy', 'RRR', 46, 65, 'Both', 15.5, 19.5, 'g/dl'),
    ('yyy', 'RRR', 66, 100, 'Both', 14.5, 18.5, 'g/dl'),
    ('yyy', 'RRR', 1, 17, 'Both', 13.0, 17.0, 'g/dl')
ON CONFLICT (test_name, sub_test_name, min_age, max_age, gender) DO UPDATE SET
    min_value = EXCLUDED.min_value,
    max_value = EXCLUDED.max_value,
    normal_unit = EXCLUDED.normal_unit,
    updated_at = NOW();