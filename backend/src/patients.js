import { pool } from "./db.js";

export async function listPatients() {
  const result = await pool.query(
    "SELECT id, name, age, gender FROM patients ORDER BY id"
  );
  return result.rows;
}

export async function getPatientProfile(id) {
  const patientResult = await pool.query(
    "SELECT * FROM patients WHERE id = $1",
    [id]
  );
  const patient = patientResult.rows[0];
  if (!patient) return null;

  const historyResult = await pool.query(
    `SELECT condition_name, diagnosed_date, status, notes
     FROM patient_medical_history
     WHERE patient_id = $1
     ORDER BY diagnosed_date DESC NULLS LAST`,
    [id]
  );

  const medicationsResult = await pool.query(
    `SELECT medication_name, dosage, frequency, start_date, end_date, prescribed_by
     FROM patient_medications
     WHERE patient_id = $1
     ORDER BY start_date DESC NULLS LAST`,
    [id]
  );

  return {
    patient,
    history: historyResult.rows,
    medications: medicationsResult.rows,
  };
}
