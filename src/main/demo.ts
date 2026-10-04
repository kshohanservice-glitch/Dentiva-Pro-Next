import type { DB } from './db/database';
import { hashPassword } from './core/passwords';
import { tx } from './core/context';
import { ALL_PERMISSIONS } from '../shared/permissions';

const DEMO_SEED_VERSION = 1;
export const DEMO_USERNAME = 'demo';
export const DEMO_PASSWORD = 'DentivaDemo2026!';

const day = (offset: number): string => {
  const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};
const at = (offset: number, hour: number, minute = 0): string => {
  const d = new Date(); d.setHours(hour, minute, 0, 0); d.setDate(d.getDate() + offset);
  return d.toISOString();
};

export async function seedDemoDatabase(db: DB): Promise<void> {
  const marker = db.prepare("SELECT value_json FROM settings WHERE key = 'demo.seedVersion'").get<{ value_json: string }>();
  if (marker?.value_json === JSON.stringify(DEMO_SEED_VERSION)) return;

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const now = new Date().toISOString();
  const today = day(0);

  tx(db, () => {
    if (Number(db.prepare('SELECT COUNT(*) c FROM users').get<{ c: number }>()!.c) > 0) return;
    const demoPerms = [...ALL_PERMISSIONS];
    db.prepare("INSERT INTO roles (key,name,description,builtin,created_at) VALUES (?,?,?,?,?)").run('demo_viewer','Demo Viewer','Read-only showcase access. Demo data cannot be modified.',0,now);
    const roleId = Number(db.prepare("SELECT id FROM roles WHERE key='demo_viewer'").get<{id:number}>()!.id);
    const grant = db.prepare('INSERT INTO role_permissions (role_id,permission_key) VALUES (?,?)');
    for (const p of demoPerms) grant.run(roleId,p);
    db.prepare("INSERT INTO users (username,display_name,password_hash,role_id,status,must_change_password,created_at,updated_at) VALUES (?,?,?,?,'active',0,?,?)").run(DEMO_USERNAME,'Demo User',passwordHash,roleId,now,now);
    const userId = Number(db.prepare("SELECT id FROM users WHERE username='demo'").get<{id:number}>()!.id);

    const clinic = { clinicName:'BrightSmile Dental Clinic — Demo', clinicNameBn:'ব্রাইটস্মাইল ডেন্টাল ক্লিনিক — ডেমো', address:'12 Lake View Road, Dhaka', phone:'+880 1700-000000', email:'demo@brightsmile.example', website:'www.brightsmile.example', operatingHours:'10:00 – 20:00', visitingDays:'Sat – Thu', currency:'BDT' };
    db.prepare('UPDATE settings SET value_json=?,updated_at=? WHERE key=?').run(JSON.stringify(clinic),now,'clinic');
    db.prepare('UPDATE settings SET value_json=? WHERE key=?').run(JSON.stringify({autoLockMinutes:0,minPasswordLength:8,maxFailedLogins:5}),'security');
    db.prepare('INSERT OR REPLACE INTO settings(key,value_json,updated_at,updated_by) VALUES(?,?,?,?)').run('demo.seedVersion',JSON.stringify(DEMO_SEED_VERSION),now,userId);

    const addDentist = db.prepare("INSERT INTO dentists(name,qualifications,designations,reg_no,phone,email,active,created_at,updated_at) VALUES(?,?,?,?,?,?,1,?,?)");
    addDentist.run('Dr. Ayesha Rahman','BDS, MPH','Consultant Dentist','BMDC-D-45821','+880 1711-111111','ayesha@brightsmile.example',now,now);
    addDentist.run('Dr. Farhan Ahmed','BDS, FCPS (Oral Surgery)','Oral & Maxillofacial Consultant','BMDC-D-39107','+880 1722-222222','farhan@brightsmile.example',now,now);
    const dentists = db.prepare('SELECT id FROM dentists ORDER BY id').all<{id:number}>(); const d1=dentists[0].id,d2=dentists[1].id;

    const addStaff=db.prepare("INSERT INTO staff(name,gender,age,address,phone,designation,department,status,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'active',?,?,?)");
    addStaff.run('Nusrat Jahan','female',29,'Dhanmondi, Dhaka','+880 1733-333333','Reception Executive','Front Desk','Demo receptionist profile',now,now);
    addStaff.run('Rafiul Karim','male',31,'Mirpur, Dhaka','+880 1744-444444','Dental Assistant','Clinical','Demo assistant profile',now,now);
    addStaff.run('Mim Akter','female',27,'Uttara, Dhaka','+880 1755-555555','Accounts Executive','Finance','Demo accounts profile',now,now);

    const addTreatment=db.prepare("INSERT INTO treatments(code,name,bengali_name,category,description,default_price_paisa,duration_min,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,1,?,?)");
    for (const t of [
      ['CONS-001','Dental Consultation','ডেন্টাল কনসালটেশন','Consultation','Comprehensive dental examination and consultation',80000,30],
      ['CLN-001','Scaling & Polishing','স্কেলিং ও পলিশিং','Preventive','Ultrasonic scaling and polishing',250000,45],
      ['FILL-001','Composite Filling','কম্পোজিট ফিলিং','Restorative','Tooth-coloured composite restoration',180000,45],
      ['RCT-001','Root Canal Treatment','রুট ক্যানাল ট্রিটমেন্ট','Endodontics','Complete root canal treatment',650000,90],
      ['EXT-001','Simple Extraction','সিম্পল এক্সট্রাকশন','Surgery','Routine tooth extraction',150000,30],
      ['XRAY-001','IOPA X-Ray','আইওপিএ এক্স-রে','Diagnostics','Intraoral periapical radiograph',50000,10],
    ]) addTreatment.run(...t,now,now);
    const trs=db.prepare('SELECT id,code FROM treatments').all<{id:number;code:string}>(); const tid=(c:string)=>trs.find(x=>x.code===c)!.id;

    const addPatient=db.prepare("INSERT INTO patients(code,name,bengali_name,dob,age_years,gender,blood_group,phone,phone2,emergency_contact,emergency_phone,address,city,chief_complaint,referred_by,preferred_dentist_id,status,registration_date,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'active',?,?,?)");
    const patients=[
      ['P-1001','Arif Hossain','আরিফ হোসেন','1991-05-14',35,'male','B+','+880 1811-100001',null,'Maliha Hossain','+880 1811-100002','Dhanmondi, Dhaka','Dhaka','Severe sensitivity in upper right molars','Google',d1],
      ['P-1002','Nabila Sultana','নাবিলা সুলতানা','1987-11-02',38,'female','O+','+880 1822-100003','+880 1822-100004','Rashed Sultana','+880 1822-100005','Uttara, Dhaka','Dhaka','Bleeding gums and bad breath','Facebook',d1],
      ['P-1003','Tanvir Ahmed','তানভীর আহমেদ','2000-02-20',26,'male','A+','+880 1833-100006',null,'Sadia Ahmed','+880 1833-100007','Mirpur, Dhaka','Dhaka','Fractured lower premolar after sports injury','Walk-in',d2],
      ['P-1004','Samia Karim','সামিয়া করিম','1995-08-17',31,'female','AB+','+880 1844-100008',null,'Mahmud Karim','+880 1844-100009','Banani, Dhaka','Dhaka','Routine cleaning and preventive check-up','Existing patient',d1],
      ['P-1005','Mahin Chowdhury','মাহিন চৌধুরী','1978-03-09',48,'male','A-','+880 1855-100010',null,'Rumana Chowdhury','+880 1855-100011','Gulshan, Dhaka','Dhaka','Persistent pain in lower left first molar','Referral',d2],
      ['P-1006','Ishrat Jahan','ইশরাত জাহান','2012-06-26',14,'female','O+','+880 1866-100012',null,'Fahim Jahan','+880 1866-100013','Mohammadpur, Dhaka','Dhaka','Orthodontic screening and oral hygiene advice','School camp',d1],
    ];
    for(const p of patients) addPatient.run(...p,day(-120),at(-120,10),at(-120,10));
    const pats=db.prepare('SELECT id,code FROM patients ORDER BY id').all<{id:number;code:string}>(); const pid=(c:string)=>pats.find(x=>x.code===c)!.id;

    const hist=db.prepare('INSERT INTO patient_histories(patient_id,kind,content,updated_at,updated_by) VALUES(?,?,?,?,?)');
    for(const h of [
      ['P-1001','medical','No known systemic disease. Occasional migraine.'],['P-1001','allergies','Penicillin allergy reported.'],['P-1001','dental','Previous composite filling on 16 and 26. Brushes once daily.'],
      ['P-1002','medical','Controlled hypertension; taking amlodipine 5 mg daily.'],['P-1002','allergies','No known drug allergies.'],['P-1002','dental','History of gingivitis; irregular dental visits.'],
      ['P-1003','medical','Fit and healthy. No regular medication.'],['P-1003','dental','Trauma to 45 during football.'],
      ['P-1004','medical','No significant medical history.'],['P-1004','dental','Good oral hygiene; annual scaling recommended.'],
      ['P-1005','medical','Type 2 diabetes, controlled with metformin.'],['P-1005','allergies','No known drug allergies.'],['P-1005','dental','Large old amalgam restoration on 36; recurrent caries suspected.'],
      ['P-1006','medical','No significant medical history.'],['P-1006','dental','Mixed dentition; early crowding noted.'],
    ]) hist.run(pid(h[0]),h[1],h[2],now,userId);

    const addVisit=db.prepare("INSERT INTO visits(patient_id,dentist_id,datetime,chief_complaint,history,examination,diagnosis,treatment_plan,advice,notes,follow_up_date,status,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,'closed',?,?,?)");
    const v1=Number(addVisit.run(pid('P-1001'),d1,at(-2,10,30),'Sensitivity in upper right molars','Cold sensitivity for 3 weeks.','Old restoration on 16; mild secondary caries.','Recurrent caries on 16.','Composite restoration after caries removal.','Desensitizing toothpaste twice daily.','Demo completed visit.',day(14),userId,at(-2,10,30),at(-2,11,10)).lastInsertRowid);
    const v2=Number(addVisit.run(pid('P-1002'),d1,at(-5,12),'Bleeding gums','Bleeding during brushing for 2 months.','Generalized plaque and calculus, mild gingival inflammation.','Generalized gingivitis.','Scaling and oral hygiene instruction.','Floss daily; review in 6 weeks.','Demo completed visit.',day(42),userId,at(-5,12),at(-5,12,45)).lastInsertRowid);
    const v3=Number(addVisit.run(pid('P-1003'),d2,at(-1,15),'Fractured lower premolar','Sports injury yesterday.','Fracture of 45 involving enamel and dentin; pulp vital.','Uncomplicated crown fracture 45.','Composite build-up and review.','Avoid biting hard foods on right side.','Demo trauma visit.',day(30),userId,at(-1,15),at(-1,15,40)).lastInsertRowid);
    const v4=Number(addVisit.run(pid('P-1005'),d2,at(-10,11),'Persistent molar pain','Pain worsens at night; thermal lingering.','Deep caries 36; percussion positive.','Irreversible pulpitis 36.','Root canal treatment planned.','Return for next RCT stage.','Demo endodontic visit.',day(7),userId,at(-10,11),at(-10,11,50)).lastInsertRowid);
    const vt=db.prepare('INSERT INTO visit_treatments(visit_id,treatment_id,description,qty,unit_price_paisa,total_paisa) VALUES(?,?,?,?,?,?)');
    vt.run(v1,tid('FILL-001'),'Composite Filling — 16',1,180000,180000); vt.run(v1,tid('XRAY-001'),'IOPA X-Ray — 16',1,50000,50000);
    vt.run(v2,tid('CLN-001'),'Scaling & Polishing',1,250000,250000); vt.run(v3,tid('FILL-001'),'Composite build-up — 45',1,180000,180000); vt.run(v4,tid('RCT-001'),'Root Canal Treatment — 36',1,650000,650000);

    const chart=db.prepare('INSERT INTO tooth_conditions(patient_id,tooth,condition,severity,visit_id,note,recorded_at,recorded_by) VALUES(?,?,?,?,?,?,?,?)');
    chart.run(pid('P-1001'),'16','caries','moderate',v1,'Recurrent caries around old restoration',at(-2,11),userId);
    chart.run(pid('P-1001'),'26','filling','mild',null,'Existing composite restoration',at(-120,10),userId);
    chart.run(pid('P-1002'),'11','calculus','mild',v2,'Supragingival calculus',at(-5,12,30),userId);
    chart.run(pid('P-1003'),'45','fracture','moderate',v3,'Enamel-dentin crown fracture',at(-1,15,30),userId);
    chart.run(pid('P-1005'),'36','caries','severe',v4,'Deep caries approaching pulp',at(-10,11,30),userId);
    chart.run(pid('P-1006'),'12','crowding','mild',null,'Early orthodontic crowding',at(-30,10),userId);

    const ap=db.prepare('INSERT INTO appointments(patient_id,dentist_id,date,time,duration_min,type,status,notes,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)');
    ap.run(pid('P-1001'),d1,today,'10:30',30,'Follow-up','confirmed','Demo follow-up appointment',userId,now,now);
    ap.run(pid('P-1002'),d1,today,'11:30',45,'Scaling','scheduled','Demo hygiene appointment',userId,now,now);
    ap.run(pid('P-1005'),d2,today,'15:00',90,'Root Canal','arrived','Demo RCT appointment',userId,now,now);
    ap.run(pid('P-1006'),d1,day(1),'16:00',30,'Consultation','scheduled','Demo orthodontic screening',userId,now,now);
    const arrived=db.prepare("SELECT id FROM appointments WHERE patient_id=? AND date=?").get<{id:number}>(pid('P-1005'),today)!.id;
    const qe=db.prepare('INSERT INTO queue_entries(day,queue_no,patient_id,appointment_id,dentist_id,arrived_at,status,priority,created_by) VALUES(?,?,?,?,?,?,?,?,?)');
    qe.run(today,1,pid('P-1005'),arrived,d2,at(0,14,40),'in_treatment',1,userId); qe.run(today,2,pid('P-1002'),null,d1,at(0,11,10),'waiting',0,userId);

    const rx=db.prepare('INSERT INTO prescriptions(number,patient_id,visit_id,dentist_id,date,c_c,o_e,r_e,diagnosis,treatment,advice,follow_up,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    const rx1=Number(rx.run('RX-2026-0042',pid('P-1001'),v1,d1,day(-2),'Sensitivity in upper right molar','Old restoration with recurrent caries','IOPA taken','Recurrent caries 16','Composite restoration','Use desensitizing toothpaste twice daily.',day(14),userId,at(-2,11,15)).lastInsertRowid);
    const rx2=Number(rx.run('RX-2026-0043',pid('P-1002'),v2,d1,day(-5),'Bleeding gums','Generalized calculus','No pocket > 4 mm','Generalized gingivitis','Scaling + chlorhexidine rinse','Improve flossing and return for review.',day(42),userId,at(-5,12,50)).lastInsertRowid);
    const rx3=Number(rx.run('RX-2026-0044',pid('P-1005'),v4,d2,day(-10),'Molar pain','Deep caries 36','Percussion positive','Irreversible pulpitis','RCT planned','Avoid chewing on affected side.',day(7),userId,at(-10,12)).lastInsertRowid);
    const rxi=db.prepare('INSERT INTO prescription_items(prescription_id,seq,medicine_name,generic,form,strength,dosage,frequency,morning,afternoon,night,timing,duration,qty,instruction,instruction_bn,note) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    rxi.run(rx1,1,'Dentiva Desensitizing Paste','Potassium nitrate','Paste','5%','Apply to sensitive area','Twice daily',1,0,1,'after','14 days','1 tube','Do not rinse immediately.','ব্যবহারের পর সঙ্গে সঙ্গে কুলি করবেন না।','Demo medicine');
    rxi.run(rx2,1,'Chlorhexidine Mouthwash','Chlorhexidine','Mouthwash','0.12%','10 mL rinse','Twice daily',1,0,1,'after','7 days','1 bottle','Rinse for 30 seconds; do not swallow.','৩০ সেকেন্ড কুলি করে ফেলে দিন।','Demo medicine');
    rxi.run(rx3,1,'Ibuprofen','Ibuprofen','Tablet','400 mg','1 tablet','After pain',0,1,1,'after','3 days','6 tablets','Take after food if needed.','প্রয়োজনে খাবারের পরে সেবন করুন।','Demo medicine');

    const inv=db.prepare('INSERT INTO invoices(number,patient_id,visit_id,date,status,subtotal_paisa,discount_paisa,total_paisa,note,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)');
    const inv1=Number(inv.run('INV-2026-0101',pid('P-1001'),v1,day(-2),'paid',230000,0,230000,'Demo paid invoice',userId,at(-2,11,20)).lastInsertRowid);
    const inv2=Number(inv.run('INV-2026-0102',pid('P-1002'),v2,day(-5),'partial',250000,0,250000,'Demo partial payment',userId,at(-5,13)).lastInsertRowid);
    const inv3=Number(inv.run('INV-2026-0103',pid('P-1005'),v4,day(-10),'unpaid',650000,0,650000,'Demo outstanding invoice',userId,at(-10,12,10)).lastInsertRowid);
    const inv4=Number(inv.run('INV-2026-0104',pid('P-1003'),v3,day(-1),'paid',180000,0,180000,'Demo paid invoice',userId,at(-1,16)).lastInsertRowid);
    const ii=db.prepare('INSERT INTO invoice_items(invoice_id,description,treatment_id,qty,unit_price_paisa,discount_paisa,total_paisa) VALUES(?,?,?,?,?,?,?)');
    ii.run(inv1,'Composite Filling — 16',tid('FILL-001'),1,180000,0,180000); ii.run(inv1,'IOPA X-Ray — 16',tid('XRAY-001'),1,50000,0,50000);
    ii.run(inv2,'Scaling & Polishing',tid('CLN-001'),1,250000,0,250000); ii.run(inv3,'Root Canal Treatment — 36',tid('RCT-001'),1,650000,0,650000); ii.run(inv4,'Composite build-up — 45',tid('FILL-001'),1,180000,0,180000);
    const pay=db.prepare("INSERT INTO payments(invoice_id,patient_id,amount_paisa,method,reference,type,received_by,paid_at,note,created_at) VALUES(?,?,?,?,?,'payment',?,?,?,?)");
    pay.run(inv1,pid('P-1001'),230000,'bkash','BK-DEMO-1001',userId,at(-2,11,25),'Demo payment',at(-2,11,25));
    pay.run(inv2,pid('P-1002'),150000,'cash','CASH-DEMO-1002',userId,at(-5,13,5),'Demo partial payment',at(-5,13,5));
    pay.run(inv4,pid('P-1003'),180000,'card','CARD-DEMO-1003',userId,at(-1,16,10),'Demo payment',at(-1,16,10));

    const supplier=Number(db.prepare('INSERT INTO suppliers(name,phone,address,created_at) VALUES(?,?,?,?)').run('Demo Dental Supplies Ltd.','+880 1700-999999','Tejgaon, Dhaka',now).lastInsertRowid);
    const item=Number(db.prepare('INSERT INTO inventory_items(code,name,category,unit,min_level,location,active,created_at,updated_at) VALUES(?,?,?,?,?,?,1,?,?)').run('INV-001','Nitrile Examination Gloves','Consumables','box',10,'Cabinet A',now,now).lastInsertRowid);
    const batch=Number(db.prepare('INSERT INTO inventory_batches(item_id,batch_no,expiry_date,qty_initial,qty_available,purchase_price_paisa,supplier_id,purchased_at,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(item,'DEMO-GLV-01',day(180),50,42,120000,supplier,day(-30),now).lastInsertRowid);
    db.prepare('INSERT INTO inventory_txns(item_id,batch_id,type,qty,reference,note,actor,at) VALUES(?,?,?,?,?,?,?,?)').run(item,batch,'in',50,'PO-DEMO-01','Demo opening stock',userId,day(-30));
    const item2=Number(db.prepare('INSERT INTO inventory_items(code,name,category,unit,min_level,location,active,created_at,updated_at) VALUES(?,?,?,?,?,?,1,?,?)').run('INV-002','Composite Syringe','Restorative','pcs',5,'Cabinet B',now,now).lastInsertRowid);
    const batch2=Number(db.prepare('INSERT INTO inventory_batches(item_id,batch_no,expiry_date,qty_initial,qty_available,purchase_price_paisa,supplier_id,purchased_at,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(item2,'DEMO-CMP-02',day(60),20,4,90000,supplier,day(-45),now).lastInsertRowid);
    db.prepare('INSERT INTO inventory_txns(item_id,batch_id,type,qty,reference,note,actor,at) VALUES(?,?,?,?,?,?,?,?)').run(item2,batch2,'in',20,'PO-DEMO-02','Demo opening stock',userId,day(-45));

    const ec=db.prepare("SELECT id FROM account_categories WHERE kind='expense' AND name='Supplies'").get<{id:number}>()!.id;
    const ic=db.prepare("SELECT id FROM account_categories WHERE kind='income' AND name='Treatment revenue'").get<{id:number}>()!.id;
    db.prepare('INSERT INTO expenses(date,category_id,amount_paisa,method,reference,note,entered_by,created_at) VALUES(?,?,?,?,?,?,?,?)').run(day(-7),ec,450000,'bank','EXP-DEMO-01','Demo dental supplies purchase',userId,at(-7,16));
    db.prepare('INSERT INTO incomes(date,category_id,amount_paisa,method,reference,note,entered_by,created_at) VALUES(?,?,?,?,?,?,?,?)').run(day(-2),ic,230000,'bkash','INC-DEMO-01','Demo treatment revenue',userId,at(-2,11,25));
    db.prepare('INSERT INTO incomes(date,category_id,amount_paisa,method,reference,note,entered_by,created_at) VALUES(?,?,?,?,?,?,?,?)').run(day(-1),ic,180000,'card','INC-DEMO-02','Demo treatment revenue',userId,at(-1,16,10));

    db.prepare('INSERT INTO notifications(key,kind,severity,title,body,entity_type,entity_id,created_at) VALUES(?,?,?,?,?,?,?,?)').run('demo.appt','appointment','info','Upcoming appointment','Nabila Sultana has a scaling appointment today at 11:30.','patient',String(pid('P-1002')),now);
    db.prepare('INSERT INTO notifications(key,kind,severity,title,body,entity_type,entity_id,created_at) VALUES(?,?,?,?,?,?,?,?)').run('demo.stock','inventory','warning','Low stock','Composite Syringe is below its minimum stock level.','inventory',String(item2),now);
    db.prepare('INSERT INTO notifications(key,kind,severity,title,body,entity_type,entity_id,created_at) VALUES(?,?,?,?,?,?,?,?)').run('demo.due','billing','danger','Outstanding payment','INV-2026-0103 has an outstanding balance of BDT 6,500.','invoice',String(inv3),now);
    db.prepare("INSERT INTO audit_log(at,user_id,username,action,entity_type,entity_id,summary,result) VALUES(?,?,?,?,?,?,?,'success')").run(now,userId,DEMO_USERNAME,'demo.seed','system',null,'Demo showcase data initialized');
  });
}
