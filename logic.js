/**
 * Smart Attendance System Pro v17.5 - PERFORMANCE OPTIMIZED
 * CONFIGURATION BLOCK
 */

const SPREADSHEET_ID = SpreadsheetApp.getActiveSpreadsheet().getId(); // অটোমেটিক আইডি নিবে, চাইলে ম্যানুয়ালি দিতে পারেন
const DRIVE_FOLDER_ID = "1mtnMDazzTCfcrIk_V12tqcO6nv3T8E_x";
const TIMEZONE = "GMT+6";

// Global Reference to Spreadsheet for better performance
const SS = SpreadsheetApp.openById(SPREADSHEET_ID);

/**
 * ক্যাশ থেকে ডাটা নেওয়া বা শিট থেকে রিড করার ফাংশন (Performance Optimization)
 */
function getSheetData(sheetName) {
  const cache = CacheService.getScriptCache();
  const cachedData = cache.get(sheetName);
  
  if (cachedData) {
    return JSON.parse(cachedData);
  }

  const sheet = SS.getSheetByName(sheetName);
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  
  // ৫ মিনিটের জন্য ক্যাশে রাখা (ঐচ্ছিক, তবে রিয়েল টাইম ডাটার জন্য কম রাখা ভালো)
  cache.put(sheetName, JSON.stringify(data), 300); 
  return data;
}

// এই ফাংশনটি নতুন অ্যাড করা হয়েছে অন্য ফাইলগুলোকে Index-এ লিঙ্ক করার জন্য
function include(filename) {
  return HtmlService.createTemplateFromFile(filename).evaluate().getContent();
}

function doGet(e) {
  var template = HtmlService.createTemplateFromFile('Index');
  return template.evaluate()
    .setTitle("Premium Attendance Pro")
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function getToday() {
  return Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd");
}

function uploadImage(base64Data, fileName) {
  try {
    const folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
    const bytes = Utilities.base64Decode(base64Data.split(',')[1]);
    const blob = Utilities.newBlob(bytes, "image/jpeg", fileName);
    const file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return "https://lh3.googleusercontent.com/d/" + file.getId();
  } catch (e) { return "Error: " + e.toString(); }
}

function authenticate(data) {
  try {
    const sheet = SS.getSheetByName("Workers");
    const userData = sheet.getDataRange().getDisplayValues();
    const currentUserEmail = Session.getActiveUser().getEmail().toLowerCase().trim();

    if (data.type === 'admin') {
      for (let i = 1; i < userData.length; i++) {
        let emailInSheet = userData[i][4].toString().toLowerCase().trim();
        let roleInSheet = userData[i][5].toString().trim();
        let uid = userData[i][0].toString().trim();
        let nameInSheet = userData[i][1];

        if (emailInSheet === currentUserEmail && (roleInSheet === 'Admin' || roleInSheet === 'Manager')) {
          return { success: true, role: roleInSheet, name: nameInSheet, uid: uid };
        }
      }
      return { success: false, msg: "Access Denied! Your email (" + currentUserEmail + ") is not registered as Admin." };
    } 

    else if (data.type === 'worker' || data.type === 'refresh') {
      if (data.type === 'refresh' && data.uid) return getWorkerFullProfile(data.uid);
      
      for (let i = 1; i < userData.length; i++) {
        let phoneInSheet = userData[i][2].toString().trim();
        let pinInSheet = userData[i][3].toString().trim();
        let uid = userData[i][0].toString().trim();

        if (phoneInSheet === data.phone.toString().trim() && pinInSheet === data.pin.toString().trim()) {
          return getWorkerFullProfile(uid);
        }
      }
    }
    return { success: false, msg: "Login Failed! Incorrect Phone or PIN." };
  } catch (e) { return { success: false, msg: "Server Error: " + e.toString() }; }
}

function getWorkerFullProfile(uid) {
  try {
    const workers = SS.getSheetByName("Workers").getDataRange().getDisplayValues();
    const workerRow = workers.find(r => r[0] == uid);
    if(!workerRow) return { success: false, msg: "Worker Not Found!" };

    const stores = SS.getSheetByName("Stores").getDataRange().getDisplayValues();
    const storeRow = stores.find(s => s[0] == workerRow[8]);
    
    return {
      success: true, role: 'Worker', uid: uid, name: workerRow[1], phone: workerRow[2],
      type: workerRow[6], rate: workerRow[7], storeName: storeRow ? storeRow[1] : "N/A", 
      storeId: workerRow[8], storeLat: storeRow ? storeRow[2] : 0, 
      storeLon: storeRow ? storeRow[3] : 0, storeRad: storeRow ? storeRow[5] : 20,
      fullHr: workerRow[9], halfHr: workerRow[10], quarHr: workerRow[11], startLimit: workerRow[12],
      prevBal: workerRow[13], prevAdv: workerRow[14], joinDate: workerRow[15], photoUrl: workerRow[16],
      stats: calculatePayroll(uid, workerRow[13], workerRow[14]), duty: checkLiveStatus(uid)
    };
  } catch (e) { return { success: false, msg: e.toString() }; }
}

function checkLiveStatus(uid, providedAttData = null) {
  const data = providedAttData || SS.getSheetByName("Attendance").getDataRange().getValues();
  const today = getToday();
  for (let i = data.length - 1; i >= 0; i--) {
    if (data[i][1] == uid) {
      const entryDate = Utilities.formatDate(new Date(data[i][0]), TIMEZONE, "yyyy-MM-dd");
      if (data[i][4] == "") {
        if (entryDate === today) return { state: "RUNNING", startTime: data[i][3].toString(), row: i+1 };
        else return { state: "PENDING", row: i+1, startTime: data[i][3].toString() };
      }
      if (entryDate === today) return { state: "COMPLETED" };
    }
  }
  return { state: "NONE" };
}

function toggleWork(uid, storeId, action, isAdmin = false) {
  try {
    const sheet = SS.getSheetByName("Attendance");
    const workers = SS.getSheetByName("Workers").getDataRange().getDisplayValues();
    const workerRow = workers.find(r => r[0] == uid);
    const status = checkLiveStatus(uid);
    const now = new Date();
    const today = getToday();

    if (action === "START") {
      if (status.state === "RUNNING") return "Error: Work is already running!";
      if (status.state === "COMPLETED") return "Error: Work completed for today!";
      if (status.state === "PENDING") return "Error: Previous session pending. Close it first.";
      
      sheet.appendRow([today, uid, storeId, now, "", "", "Running", 0, isAdmin ? "Manual" : "Device"]);
      return "SUCCESS: Work Started!";
    } else {
      if (status.row) {
        const start = new Date(status.startTime);
        const diffHrs = (now - start) / (1000 * 60 * 60);
        
        const earn = calculateDailyEarning(
          diffHrs, 
          workerRow[6], 
          workerRow[7], 
          workerRow[9], 
          workerRow[10], 
          workerRow[11], 
          status.startTime 
        );

        sheet.getRange(status.row, 5).setValue(now);
        sheet.getRange(status.row, 6).setValue(diffHrs.toFixed(2));
        sheet.getRange(status.row, 7).setValue("Completed");
        sheet.getRange(status.row, 8).setValue(Math.round(earn));
        return "SUCCESS: Work Stopped!";
      }
      return "Error: Session Not Found!";
    }
  } catch (e) { return "Error: " + e.toString(); }
}

function calculateDailyEarning(hrs, type, rate, fH, hH, qH, entryDate) {
  if (type == "Hourly") return hrs * rate;
  let d = new Date(entryDate);
  let dim = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  let perDay = (type == "Daily") ? rate : rate / dim;
  
  if (hrs >= fH) return perDay;
  if (hrs >= hH) return perDay / 2;
  if (hrs >= qH) return perDay / 4;
  return 0;
}

function calculatePayroll(uid, pBal = 0, pAdv = 0, attendanceData = null, paymentData = null) {
  const att = attendanceData || SS.getSheetByName("Attendance").getDataRange().getValues();
  const pay = paymentData || SS.getSheetByName("Payments").getDataRange().getValues();
  
  let earned = Number(pBal || 0);
  let paid = Number(pAdv || 0);

  earned = att.reduce((sum, row) => {
    return (row[1] == uid && row[7] !== "") ? sum + Number(row[7]) : sum;
  }, earned);

  paid = pay.reduce((sum, row) => {
    return (row[1] == uid && row[2] !== "") ? sum + Number(row[2]) : sum;
  }, paid);

  return { 
    earned: Math.round(earned), 
    paid: Math.round(paid), 
    balance: Math.round(earned - paid) 
  };
}

function getAdminData() {
  const workerSheet = SS.getSheetByName("Workers");
  const attSheet = SS.getSheetByName("Attendance");
  const paySheet = SS.getSheetByName("Payments");
  const storeSheet = SS.getSheetByName("Stores");

  const allWorkersRaw = workerSheet.getDataRange().getDisplayValues().slice(1);
  const workers = allWorkersRaw.filter(w => w[5] !== 'Admin');
  const allAtt = attSheet.getDataRange().getValues();
  const allPay = paySheet.getDataRange().getValues();
  const stores = storeSheet.getDataRange().getDisplayValues().slice(1);

  return { 
    workers: workers.map(w => {
      const uid = w[0];
      const stats = calculatePayroll(uid, w[13], w[14], allAtt, allPay);
      return { 
        uid: uid, name: w[1], storeId: w[8], photo: w[16], 
        onDuty: checkLiveStatus(uid, allAtt).state === "RUNNING", 
        stats: stats 
      };
    }),
    stores: stores 
  };
}

function getStoreProfile(id) {
  try {
    const stores = SS.getSheetByName("Stores").getDataRange().getDisplayValues();
    const s = stores.find(r => r[0] == id);
    if(!s) return null;
    return { id: s[0], name: s[1], lat: s[2], lon: s[3], addr: s[4], rad: s[5], photoUrl: s[6] };
  } catch (e) { return null; }
}

function saveEntity(type, obj) {
  try {
    const sheet = SS.getSheetByName(type === 'worker' ? "Workers" : "Stores");
    const data = sheet.getDataRange().getValues();

    // --- ডুপ্লিকেট ফোন নম্বর চেক (শুধুমাত্র নতুন ওয়ার্কার যোগ করার সময়) ---
    if (!obj.uid && type === 'worker') {
      const phoneIndex = 2; // Column C (Phone Number)
      for (let i = 1; i < data.length; i++) {
        if (data[i][phoneIndex].toString().trim() === obj.phone.toString().trim()) {
          return "Error: এই ফোন নম্বরটি দিয়ে অলরেডি একজন ওয়ার্কার রেজিস্টার্ড আছে!";
        }
      }
    }

    if (obj.uid || obj.id) {
      let id = obj.uid || obj.id;
      for (let i = 1; i < data.length; i++) {
        if (data[i][0] == id) {
          if (type === 'worker') {
            let finalWorkerPhoto = obj.photoUrl || data[i][16];
            sheet.getRange(i + 1, 2, 1, 16).setValues([[
              obj.name, obj.phone, data[i][3], data[i][4], data[i][5], 
              obj.type, obj.rate, obj.storeId, obj.fHr, obj.hHr, 
              obj.qHr, obj.sLimit, obj.pBal, obj.pAdv, obj.jDate, finalWorkerPhoto
            ]]);
          } else {
            let finalStorePhoto = obj.photoUrl || data[i][6];
            sheet.getRange(i + 1, 2, 1, 6).setValues([[
              obj.name, obj.lat, obj.lon, obj.addr, obj.rad, finalStorePhoto
            ]]);
          }
          return "SUCCESS: Updated!";
        }
      }
    } else {
      if (type === 'worker') {
        sheet.appendRow(["W" + Date.now(), obj.name, obj.phone, "1111", "", "Worker", obj.type, obj.rate, obj.storeId, obj.fHr, obj.hHr, obj.qHr, obj.sLimit, obj.pBal, obj.pAdv, obj.jDate, obj.photoUrl]);
        sheet.getRange(sheet.getLastRow(), 4).setNumberFormat("@");
      } else {
        sheet.appendRow(["S" + Date.now(), obj.name, obj.lat, obj.lon, obj.addr, obj.rad, obj.photoUrl]);
      }
      return "SUCCESS: Added!";
    }
  } catch (e) { return "Error: " + e.toString(); }
}

function autoCloseSessions() {
  const sheet = SS.getSheetByName("Attendance");
  const data = sheet.getDataRange().getValues();
  const today = getToday();

  for (let i = 1; i < data.length; i++) {
    let entryDate = Utilities.formatDate(new Date(data[i][0]), TIMEZONE, "yyyy-MM-dd");
    if (data[i][4] === "" && entryDate !== today) {
      sheet.getRange(i + 1, 7).setValue("Pending");
    }
  }
}

function getAdminFullReport(month, year) {
  const workers = SS.getSheetByName("Workers").getDataRange().getDisplayValues().slice(1)
                .filter(w => w[5] !== 'Admin');
  return workers.map(w => {
    let s = getMonthlyReportData(w[0], month, year);
    return { name: w[1], ...s, balance: Math.round(s.earned - s.paid) };
  });
}

function getMonthlyReportData(uid, month, year) {
  try {
    const attData = SS.getSheetByName("Attendance").getDataRange().getValues();
    const workers = SS.getSheetByName("Workers").getDataRange().getValues();
    const worker = workers.find(r => r[0] == uid);
    if (!worker) return { error: "Worker not found" };
    
    const holidays = getWorkerHolidays(uid);
    let targetM = parseInt(month); 
    let targetY = parseInt(year);
    let now = new Date();
    
    // ঐ মাসের মোট দিন সংখ্যা বের করা
    let daysInM = new Date(targetY, targetM + 1, 0).getDate();
    
    // কত তারিখ পর্যন্ত অ্যাবসেন্ট চেক করবে তার লজিক
    let checkUntil;
    if (targetY < now.getFullYear() || (targetY === now.getFullYear() && targetM < now.getMonth())) {
      checkUntil = daysInM; // অতীত মাসের জন্য পুরো মাস
    } else if (targetY === now.getFullYear() && targetM === now.getMonth()) {
      checkUntil = now.getDate(); // বর্তমান মাসের জন্য আজ পর্যন্ত
    } else {
      checkUntil = 0; // ভবিষ্যৎ মাসের জন্য ০
    }

    // নির্দিষ্ট মাসের অ্যাটেনডেন্স ফিল্টার করা
    const monthlyAtt = attData.filter(r => {
      if (!r[0] || r[1] != uid) return false;
      let d = new Date(r[0]);
      return d.getMonth() == targetM && d.getFullYear() == targetY;
    });

    let stats = { full: 0, half: 0, quarter: 0, absent: 0, holiday: 0, earned: 0, paid: 0 };
    let workedDays = [];

    // ঘণ্টার থ্রেশহোল্ডগুলো নাম্বারে কনভার্ট করা
    const fHr = Number(worker[9]);
    const hHr = Number(worker[10]);
    const qHr = Number(worker[11]);

    monthlyAtt.forEach(r => {
      let d = new Date(r[0]);
      let day = d.getDate();
      if(!workedDays.includes(day)) workedDays.push(day);
      
      stats.earned += Number(r[7] || 0);
      let hrs = parseFloat(r[5] || 0);
      
      if (hrs >= fHr) stats.full++; 
      else if (hrs >= hHr) stats.half++; 
      else if (hrs >= qHr) stats.quarter++;
    });

    // প্রতিদিনের বেতন ক্যালকুলেশন
    let perDaySalary = (worker[6] == "Daily") ? Number(worker[7]) : Number(worker[7] || 0) / daysInM;

    // হলিডে এবং অ্যাবসেন্ট ক্যালকুলেশন
    for (let d = 1; d <= checkUntil; d++) {
      let dateStr = `${targetY}-${(targetM + 1).toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}`;
      let hFound = holidays.find(h => h.date === dateStr);
      
      if (!workedDays.includes(d)) {
        if (hFound) {
          stats.holiday++;
          if (hFound.status === "Paid") stats.earned += perDaySalary; 
        } else {
          // আজ যদি ডিউটি রানিং না থাকে তবেই অ্যাবসেন্ট ধরবে
          stats.absent++;
        }
      }
    }

    // পেমেন্ট হিসাব
    const payData = SS.getSheetByName("Payments").getDataRange().getValues();
    let pSum = 0;
    payData.slice(1).forEach(r => { 
      if(r[1] == uid && r[0] != "") {
        let pd = new Date(r[0]);
        if(pd.getMonth() == targetM && pd.getFullYear() == targetY) pSum += Number(r[2]); 
      }
    });
    
    stats.paid = Math.round(pSum); 
    stats.earned = Math.round(stats.earned);
    return stats;
  } catch (e) { 
    console.log(e.toString());
    return { error: e.toString(), full:0, half:0, quarter:0, absent:0, holiday:0 }; 
  }
}

function getWorkerHolidays(uid) {
  try {
    const sheet = SS.getSheetByName("Holidays");
    if(!sheet) return [];
    const data = sheet.getDataRange().getValues();
    return data.filter(r => r[1] == uid || r[1] == "ALL").map(r => ({
      date: Utilities.formatDate(new Date(r[0]), TIMEZONE, "yyyy-MM-dd"),
      note: r[2], status: r[3]
    }));
  } catch (e) { return []; }
}

function changePin(uid, p) { 
  const sheet = SS.getSheetByName("Workers");
  const data = sheet.getDataRange().getValues();
  for (let i = 0; i < data.length; i++) {
    if (data[i][0] == uid) {
      const cell = sheet.getRange(i + 1, 4);
      cell.setNumberFormat("@"); 
      cell.setValue(p.toString());
      return "PIN Updated!";
    }
  }
  return "Error updating PIN.";
}

function addPayment(obj) { SS.getSheetByName("Payments").appendRow([new Date(), obj.uid, obj.amount, obj.desc, "Admin", "Payment"]); return "Done."; }

function saveHoliday(obj) {
  try {
    const sheet = SS.getSheetByName("Holidays");
    sheet.appendRow([obj.date, obj.uid, obj.note, obj.status]);
    return "SUCCESS: Holiday recorded!";
  } catch (e) { return "Error: " + e.toString(); }
}

function submitLeave(obj) {
  try {
    const sheet = SS.getSheetByName("LeaveRequests");
    sheet.appendRow(["LR" + Date.now(), obj.uid, obj.name, obj.startDate, obj.endDate, obj.reason, "Pending", new Date()]);
    return "SUCCESS: Leave application submitted!";
  } catch (e) { return "Error: " + e.toString(); }
}

function getWorkerLeaves(uid) {
  const data = SS.getSheetByName("LeaveRequests").getDataRange().getDisplayValues();
  return data.filter(r => r[1] == uid).map(r => ({ id: r[0], start: r[3], end: r[4], reason: r[5], status: r[6] }));
}

function getPendingLeaves() {
  const data = SS.getSheetByName("LeaveRequests").getDataRange().getDisplayValues();
  return data.filter(r => r[6] == "Pending").map(r => ({ id: r[0], uid: r[1], name: r[2], start: r[3], end: r[4], reason: r[5] }));
}

function updateLeaveStatus(id, status, isPaid = "Unpaid") {
  const sheet = SS.getSheetByName("LeaveRequests");
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] == id) {
      sheet.getRange(i + 1, 7).setValue(status);
      if (status === "Approved") {
        saveHoliday({ date: Utilities.formatDate(new Date(data[i][3]), TIMEZONE, "yyyy-MM-dd"), uid: data[i][1], note: "Leave: " + data[i][5], status: isPaid });
      }
      return "SUCCESS: Leave " + status;
    }
  }
}

// এই ফাংশনটি নির্দিষ্ট মাসের আগের মাসের ব্যালেন্স বের করবে
function getOpeningBalance(uid, month, year) {
  const worker = SS.getSheetByName("Workers").getDataRange().getValues().find(r => r[0] == uid);
  const attData = SS.getSheetByName("Attendance").getDataRange().getValues();
  const payData = SS.getSheetByName("Payments").getDataRange().getValues();
  
  let openingDate = new Date(year, month, 1);
  
  let earnedBefore = Number(worker[13] || 0); // Initial Prev Bal
  let paidBefore = Number(worker[14] || 0);   // Initial Prev Adv

  // শুরু থেকে এই মাসের আগের দিন পর্যন্ত সব উপার্জন যোগ
  attData.forEach(r => {
    if (r[1] == uid && r[0] !== "" && new Date(r[0]) < openingDate) {
      earnedBefore += Number(r[7] || 0);
    }
  });

  // শুরু থেকে এই মাসের আগের দিন পর্যন্ত সব পেমেন্ট যোগ
  payData.forEach(r => {
    if (r[1] == uid && r[0] !== "" && new Date(r[0]) < openingDate) {
      paidBefore += Number(r[2] || 0);
    }
  });

  return earnedBefore - paidBefore;
}

// মূল পে-স্লিপ জেনারেটর
function generatePaySlip(uid, month, year) {
  try {
    const worker = getWorkerFullProfile(uid);
    const report = getMonthlyReportData(uid, month, year);
    const openingBal = getOpeningBalance(uid, month, year);
    const closingBal = openingBal + report.earned - report.paid;
    
    const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    
    // ব্যালেন্স যদি মাইনাস হয় তবে লাল রঙের স্টাইল
    const balColor = closingBal < 0 ? "#ff4d4d" : "#2ecc71";
    const balText = closingBal < 0 ? `Advance: ₹${Math.abs(closingBal)}` : `Balance: ₹${closingBal}`;

    let html = `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 20px; color: #333; max-width: 700px; margin: auto; border: 1px solid #ddd; border-radius: 10px;">
      <div style="text-align: center; border-bottom: 2px solid #D4AF37; padding-bottom: 10px; margin-bottom: 20px;">
        <h1 style="margin: 0; color: #D4AF37; letter-spacing: 2px;">PAY SLIP</h1>
        <p style="margin: 5px 0; font-weight: bold;">${months[month]} - ${year}</p>
      </div>

      <div style="display: flex; justify-content: space-between; margin-bottom: 20px; font-size: 14px;">
        <div>
          <p><b>Worker Name:</b> ${worker.name}</p>
          <p><b>Staff ID:</b> ${worker.uid}</p>
          <p><b>Store:</b> ${worker.storeName}</p>
        </div>
        <div style="text-align: right;">
          <p><b>Phone:</b> ${worker.phone}</p>
          <p><b>Salary Rate:</b> ₹${worker.rate} (${worker.type})</p>
          <p><b>Printed On:</b> ${new Date().toLocaleDateString()}</p>
        </div>
      </div>

      <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 14px;">
        <thead>
          <tr style="background: #f4f4f4; border-bottom: 2px solid #ddd;">
            <th style="padding: 10px; text-align: left;">Attendance Description</th>
            <th style="padding: 10px; text-align: center;">Days</th>
          </tr>
        </thead>
        <tbody>
          <tr><td style="padding: 8px; border-bottom: 1px solid #eee;">Full Present (F)</td><td style="text-align: center;">${report.full}</td></tr>
          <tr><td style="padding: 8px; border-bottom: 1px solid #eee;">Half Present (H)</td><td style="text-align: center;">${report.half}</td></tr>
          <tr><td style="padding: 8px; border-bottom: 1px solid #eee;">Quarter Present (Q)</td><td style="text-align: center;">${report.quarter}</td></tr>
          <tr><td style="padding: 8px; border-bottom: 1px solid #eee;">Holidays (Paid/Unpaid)</td><td style="text-align: center;">${report.holiday}</td></tr>
          <tr style="color: #e74c3c;"><td style="padding: 8px; border-bottom: 1px solid #eee;">Absent</td><td style="text-align: center;">${report.absent}</td></tr>
        </tbody>
      </table>

      <div style="background: #f9f9f9; padding: 15px; border-radius: 8px;">
        <h4 style="margin-top: 0; color: #555; border-bottom: 1px solid #ddd; padding-bottom: 5px;">Salary Calculation</h4>
        <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
          <span>Opening Balance (Prev. Month)</span>
          <span style="font-weight: bold; color: ${openingBal < 0 ? 'red' : 'black'}">₹${openingBal}</span>
        </div>
        <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
          <span>Earnings (Current Month)</span>
          <span style="font-weight: bold; color: #2ecc71;">+ ₹${report.earned}</span>
        </div>
        <div style="display: flex; justify-content: space-between; margin-bottom: 10px;">
          <span>Advance/Payment Received</span>
          <span style="font-weight: bold; color: #e74c3c;">- ₹${report.paid}</span>
        </div>
        <div style="display: flex; justify-content: space-between; padding-top: 10px; border-top: 2px dashed #ddd; font-size: 18px; font-weight: bold;">
          <span>Net Payable</span>
          <span style="color: ${balColor};">${balText}</span>
        </div>
      </div>

      <div style="margin-top: 30px; font-size: 12px; text-align: center; color: #888;">
        <p>This is a computer-generated pay slip and does not require a signature.</p>
      </div>
    </div>`;

    const blob = Utilities.newBlob(html, "text/html", "PaySlip.html");
    const pdf = blob.getAs("application/pdf").setName(`PaySlip_${worker.name}_${months[month]}.pdf`);
    const file = DriveApp.getFolderById(DRIVE_FOLDER_ID).createFile(pdf);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return file.getUrl();
  } catch (e) { return "Error: " + e.toString(); }
}

function processRequest(e) {
  const request = JSON.parse(e.postData.contents);
  const result = this[request.functionName].apply(null, request.parameters);
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}
