CREATE TABLE IF NOT EXISTS patients (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    age INT NOT NULL,
    gender TEXT NOT NULL,
    contact_number TEXT,
    blood_group TEXT,
    admission_date DATE,
    created_at TIMESTAMP DEFAULT NOW()
);
