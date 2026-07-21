import { fileURLToPath } from "url";
import { pool } from "./db.js";

// condition -> medication template, reused across patients for realism
const CONDITION_MEDICATIONS = {
  Diabetes: { medication_name: "Metformin", dosage: "500mg", frequency: "Twice daily" },
  Hypertension: { medication_name: "Amlodipine", dosage: "5mg", frequency: "Once daily" },
  Asthma: { medication_name: "Salbutamol Inhaler", dosage: "100mcg", frequency: "As needed" },
  Gastroenteritis: { medication_name: "Oral Rehydration Salts", dosage: "1 sachet", frequency: "As needed" },
  "Common Cold": { medication_name: "Paracetamol", dosage: "500mg", frequency: "As needed" },
  Migraine: { medication_name: "Sumatriptan", dosage: "50mg", frequency: "As needed" },
  Arthritis: { medication_name: "Ibuprofen", dosage: "400mg", frequency: "Twice daily" },
  Hypothyroidism: { medication_name: "Levothyroxine", dosage: "50mcg", frequency: "Once daily" },
  Anemia: { medication_name: "Ferrous Sulfate", dosage: "325mg", frequency: "Once daily" },
  "Coronary Artery Disease": { medication_name: "Atorvastatin", dosage: "20mg", frequency: "Once daily" },
};

const DOCTORS = ["Dr. Mehta", "Dr. Rao", "Dr. Iyer", "Dr. Sharma", "Dr. Kapoor"];

const PATIENTS = [
  { name: "Aarav Sharma", age: 45, gender: "Male", blood_group: "B+", conditions: ["Diabetes", "Hypertension"] },
  { name: "Priya Nair", age: 32, gender: "Female", blood_group: "O+", conditions: ["Asthma"] },
  { name: "Rohan Verma", age: 58, gender: "Male", blood_group: "A+", conditions: ["Coronary Artery Disease", "Hypertension"] },
  { name: "Ananya Iyer", age: 27, gender: "Female", blood_group: "AB+", conditions: ["Migraine"] },
  { name: "Vikram Singh", age: 63, gender: "Male", blood_group: "O-", conditions: ["Diabetes", "Arthritis"] },
  { name: "Sneha Reddy", age: 41, gender: "Female", blood_group: "B-", conditions: ["Hypothyroidism"] },
  { name: "Karan Mehta", age: 22, gender: "Male", blood_group: "A-", conditions: ["Common Cold"] },
  { name: "Isha Kapoor", age: 36, gender: "Female", blood_group: "O+", conditions: ["Anemia"] },
  { name: "Arjun Rao", age: 50, gender: "Male", blood_group: "B+", conditions: ["Hypertension"] },
  { name: "Meera Pillai", age: 29, gender: "Female", blood_group: "AB-", conditions: ["Gastroenteritis"] },
  { name: "Aditya Joshi", age: 55, gender: "Male", blood_group: "A+", conditions: ["Diabetes", "Coronary Artery Disease"] },
  { name: "Divya Menon", age: 34, gender: "Female", blood_group: "O+", conditions: ["Migraine", "Anemia"] },
  { name: "Rahul Gupta", age: 47, gender: "Male", blood_group: "B+", conditions: ["Arthritis"] },
  { name: "Kavya Nambiar", age: 25, gender: "Female", blood_group: "A+", conditions: ["Asthma"] },
  { name: "Siddharth Bose", age: 60, gender: "Male", blood_group: "O-", conditions: ["Hypertension", "Hypothyroidism"] },
  { name: "Neha Choudhary", age: 38, gender: "Female", blood_group: "B+", conditions: ["Common Cold"] },
  { name: "Manish Trivedi", age: 52, gender: "Male", blood_group: "AB+", conditions: ["Diabetes"] },
  { name: "Pooja Desai", age: 30, gender: "Female", blood_group: "O+", conditions: ["Gastroenteritis"] },
  { name: "Vivaan Malhotra", age: 44, gender: "Male", blood_group: "A-", conditions: ["Coronary Artery Disease"] },
  { name: "Ritika Sinha", age: 33, gender: "Female", blood_group: "B-", conditions: ["Anemia", "Migraine"] },
];

function daysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export async function seedPatients() {
  await pool.query(
    "TRUNCATE patient_medications, patient_medical_history, patients RESTART IDENTITY CASCADE"
  );

  for (let i = 0; i < PATIENTS.length; i++) {
    const p = PATIENTS[i];
    const doctor = DOCTORS[i % DOCTORS.length];

    const patientResult = await pool.query(
      `INSERT INTO patients (name, age, gender, contact_number, blood_group, admission_date)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        p.name,
        p.age,
        p.gender,
        `+91-90000${String(10000 + i).slice(-5)}`,
        p.blood_group,
        daysAgo(30 + i * 5),
      ]
    );
    const patientId = patientResult.rows[0].id;

    for (const condition of p.conditions) {
      await pool.query(
        `INSERT INTO patient_medical_history (patient_id, condition_name, diagnosed_date, status, notes)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          patientId,
          condition,
          daysAgo(180 + i * 10),
          "active",
          `Diagnosed during routine checkup, being managed by ${doctor}.`,
        ]
      );

      const med = CONDITION_MEDICATIONS[condition];
      await pool.query(
        `INSERT INTO patient_medications (patient_id, medication_name, dosage, frequency, start_date, prescribed_by)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [patientId, med.medication_name, med.dosage, med.frequency, daysAgo(150 + i * 10), doctor]
      );
    }

    console.log(`Seeded patient: ${p.name} (id ${patientId}), conditions: ${p.conditions.join(", ")}`);
  }
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  seedPatients()
    .then(() => {
      console.log("Patient seeding complete.");
      process.exit(0);
    })
    .catch((err) => {
      console.error("Patient seeding failed:", err);
      process.exit(1);
    });
}
