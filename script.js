const WEB_APP_URL = "https://script.google.com/macros/s/AKfycbxw44V3kHzzUIdRpZJkCw9EVwlFW0EMzqYbOtXngB67HW0YVcVHzG4Vm9EKhRpNd3YOTg/execে"; 
const google = {
  script: {
    run: new Proxy({}, {
      get: (target, prop) => {
        let successHandler = (res) => {};
        return {
          withSuccessHandler: function(cb) { successHandler = cb; return this; },
          [prop]: function(...args) {
            fetch(WEB_APP_URL, { method: "POST", body: JSON.stringify({ functionName: prop, parameters: args }) })
            .then(r => r.json()).then(data => successHandler(data));
          }
        };
      }
    })
  }
};

 let user = null, watchId = null, map, marker, currentEditId = null, cropper = null;
    let croppedBase64 = null, currentCropType = "";
    
    const trans = {
        en: { earn: "EARNED", paid: "PAID", bal: "BALANCE", menu: "MENU", refresh: "Refresh", pin: "PIN", logout: "Logout" },
        bn: { earn: "উপার্জন", paid: "প্রদান", bal: "অবশিষ্ট", menu: "মেনু", refresh: "রিফ্রেশ", pin: "পিন", logout: "লগআউট" }
    };

    function initApp() {
        const session = localStorage.getItem('userSession');
        if(session) {
            try {
                user = JSON.parse(session);
                renderDash();
            } catch(e) { logout(); }
        }
    }

    function handleLogin(role) {
        const btn = role === 'admin' ? document.getElementById('adminLoginBtn') : document.getElementById('loginBtn');
        const phone = document.getElementById('phone').value;
        const pin = document.getElementById('pin').value;
        
        if(role === 'worker') {
            if(!phone || !pin) { alert("Enter Phone & PIN!"); return; }
        }
        
        btn.disabled = true; 
        btn.innerText = "Authenticating...";
        
        google.script.run.withSuccessHandler(res => {
            if(res.success) {
                user = res;
                localStorage.setItem('userSession', JSON.stringify(res));
                renderDash();
            } else {
                alert(res.msg);
                btn.disabled = false;
                btn.innerText = role === 'admin' ? "ADMIN ACCESS" : "WORKER LOGIN";
            }
        }).authenticate({type: role, phone: phone, pin: pin});
    }

    function renderDash() {
        if(!user) return;
        document.getElementById('loginPage').classList.add('hidden');
        document.getElementById('mainContent').classList.remove('hidden');
        setupMonths();
        
        if(user.role === 'Worker') {
            document.getElementById('adminDash').classList.add('hidden');
            document.getElementById('workerDash').classList.remove('hidden');
            document.getElementById('wMainPhoto').src = user.photoUrl || 'https://via.placeholder.com/100';
            document.getElementById('wNameDisp').innerText = "Hello, " + user.name;
            document.getElementById('wEarned').innerText = "₹" + user.stats.earned;
            document.getElementById('wPaid').innerText = "₹" + user.stats.paid;
            document.getElementById('wBalance').innerText = "₹" + user.stats.balance;
            updateWorkerUI();
            loadWorkerReport();
            renderHolidayCalendar(user.uid); // নতুন ক্যালেন্ডার কল
        } else {
            document.getElementById('workerDash').classList.add('hidden');
            document.getElementById('adminDash').classList.remove('hidden');
            loadAdminData();
            setTimeout(initMap, 500);
        }
        changeLang();
    }

     function updateWorkerUI() {
        const btn = document.getElementById('actionBtn');
        if(!btn) return;

        // আপনার চাহিদা অনুযায়ী কন্ডিশন আপডেট
        if(user.duty.state === "COMPLETED") {
            btn.innerText = "TODAY WORK IS DONE"; 
            btn.className = "btn btn-secondary w-100 py-3 fw-bold"; 
            btn.disabled = true;
            if(watchId) navigator.geolocation.clearWatch(watchId);
            document.getElementById('gpsText').innerHTML = "✅ Work session finished for today.";
        } else if(user.duty.state === "RUNNING" || user.duty.state === "PENDING") {
            btn.innerText = "STOP WORK"; 
            btn.className = "btn btn-stop w-100 py-3 fw-bold"; 
            btn.disabled = true; // জিপিএস সিঙ্ক না হওয়া পর্যন্ত ডিসেবল থাকবে
            startGps();
        } else {
            btn.innerText = "START WORK"; 
            btn.className = "btn btn-gold w-100 py-3 fw-bold"; 
            btn.disabled = true; 
            startGps();
        }
    }

    function startGps() {
        if(watchId) navigator.geolocation.clearWatch(watchId);
        watchId = navigator.geolocation.watchPosition(pos => {
            const acc = pos.coords.accuracy;
            const dist = calculateDist(pos.coords.latitude, pos.coords.longitude, user.storeLat, user.storeLon);
            const btn = document.getElementById('actionBtn'), rad = user.storeRad || 20;

            if (acc > 100) {
                btn.disabled = true;
                document.getElementById('gpsText').innerHTML = `⚠️ Low GPS Accuracy: ${Math.round(acc)}m. <br>Move to an open space.`;
                return;
            }

            if(dist <= rad) {
                btn.disabled = false;
                document.getElementById('gpsText').innerHTML = `🟢 IN RANGE (Acc: ${Math.round(acc)}m)`;
            } else {
                btn.disabled = true;
                document.getElementById('gpsText').innerHTML = `🔴 OUTSIDE: ${Math.round(dist)}m (Acc: ${Math.round(acc)}m)`;
            }
        }, err => {
            document.getElementById('gpsText').innerHTML = "❌ GPS Error! Enable Location.";
        }, {enableHighAccuracy: true});
    }

    function calculateDist(lat1, lon1, lat2, lon2) {
        const R = 6371e3;
        const φ1 = lat1 * Math.PI/180;
        const φ2 = lat2 * Math.PI/180;
        const Δφ = (lat2-lat1) * Math.PI/180;
        const Δλ = (lon2-lon1) * Math.PI/180;
        const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ/2) * Math.sin(Δλ/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
    }

    function toggleAttendance() {
        const action = (user.duty.state === "RUNNING" || user.duty.state === "PENDING") ? "STOP" : "START";
        if(action === "STOP" && !confirm("Stop session?")) return;
        google.script.run.withSuccessHandler(msg => {
            alert(msg); refreshSession();
        }).toggleWork(user.uid, user.storeId, action, false);
    }

    function adminToggle(u, s, onDuty) {
        const action = onDuty ? "STOP" : "START";
        if(confirm(`Manual ${action} for worker?`)) {
            google.script.run.withSuccessHandler(msg => {
                alert(msg); loadAdminData();
            }).toggleWork(u, s, action, true);
        }
    }

    function loadAdminData() {
        google.script.run.withSuccessHandler(data => {
            document.getElementById('workerList').innerHTML = data.workers.map(w => `<div class="premium-card d-flex justify-content-between align-items-center p-2">
                <div class="d-flex align-items-center">
                    <img src="${w.photo || 'https://via.placeholder.com/45'}" class="rounded-circle me-3" style="width:45px;height:45px;object-fit:cover;">
                    <div><span class="status-dot ${w.onDuty?'online':'offline'}"></span><strong>${w.name}</strong><br><small>₹${w.stats.balance}</small></div>
                </div>
                <div class="dropdown">
                    <button class="btn btn-outline-warning btn-sm dropdown-toggle" data-bs-toggle="dropdown">Action</button>
                    <ul class="dropdown-menu bg-dark border-secondary">
                        <li><a class="dropdown-item text-white" onclick="adminToggle('${w.uid}','${w.storeId}',${w.onDuty})">${w.onDuty?'Stop':'Start'}</a></li>
                        <li><a class="dropdown-item text-white" onclick="editWorker('${w.uid}')">Edit</a></li>
                        <li><a class="dropdown-item text-white" onclick="setHoliday('${w.uid}')">Set Holiday</a></li> <!-- ছুটি সেটের অপশন -->
                        <li><a class="dropdown-item text-white" onclick="adminPay('${w.uid}','${w.name}')">Pay</a></li>
                    </ul>
                </div>
            </div>`).join('');
            document.getElementById('wInStore').innerHTML = data.stores.map(s => `<option value="${s[0]}">${s[1]}</option>`).join('');
            document.getElementById('storeList').innerHTML = data.stores.map(s => `<div class="premium-card p-0 overflow-hidden">
                <img src="${s[6] || 'https://via.placeholder.com/300x120'}" class="store-img-list">
                <div class="p-2 d-flex justify-content-between align-items-center">
                    <div><strong>${s[1]}</strong><br><small>${s[4]}</small></div>
                    <button class="btn btn-outline-info btn-sm" onclick="editStore('${s[0]}')">Edit</button>
                </div>
            </div>`).join('');
            loadAdminReport();
        }).getAdminData();
    }

    function startCrop(input, type) {
        if (input.files && input.files[0]) {
            currentCropType = type;
            const reader = new FileReader();
            reader.onload = e => {
                document.getElementById('cropTarget').src = e.target.result;
                document.getElementById('cropModal').style.display = 'flex';
                if(cropper) cropper.destroy();
                cropper = new Cropper(document.getElementById('cropTarget'), { aspectRatio: type==='worker'?1:16/9, viewMode: 1, rotatable: true });
            };
            reader.readAsDataURL(input.files[0]);
        }
    }
    
    function finishCrop() {
        croppedBase64 = cropper.getCroppedCanvas({ width: 400 }).toDataURL('image/jpeg', 0.8);
        document.getElementById(currentCropType==='worker'?'wInPhotoPrev':'sInImagePrev').src = croppedBase64;
        closeCrop();
    }
    function closeCrop() { document.getElementById('cropModal').style.display = 'none'; }

    async function submitWorker() {
        const btn = document.getElementById('wSaveBtn');
        btn.disabled = true; btn.innerText = "Saving...";
        let pUrl = (currentEditId && user && user.photoUrl) ? user.photoUrl : "";
        if(croppedBase64) pUrl = await new Promise(res => google.script.run.withSuccessHandler(res).uploadImage(croppedBase64, "W_"+Date.now()));
        const obj = {
            uid: currentEditId, name: document.getElementById('wInName').value, phone: document.getElementById('wInPhone').value,
            rate: document.getElementById('wInRate').value, type: "Monthly", storeId: document.getElementById('wInStore').value,
            fHr: document.getElementById('wInF').value, hHr: document.getElementById('wInH').value, qHr: document.getElementById('wInQ').value,
            sLimit: document.getElementById('wInLimit').value, pBal: document.getElementById('wInPBal').value, pAdv: document.getElementById('wInPAdv').value,
            jDate: document.getElementById('wInJDate').value, photoUrl: pUrl
        };
        google.script.run.withSuccessHandler(m => { alert(m); loadAdminData(); openWorkerForm(false); btn.disabled = false; btn.innerText = "SAVE WORKER"; }).saveEntity('worker', obj);
    }

    async function submitStore() {
        const btn = document.getElementById('sSaveBtn');
        btn.disabled = true;
        let pUrl = "";
        if(croppedBase64) pUrl = await new Promise(res => google.script.run.withSuccessHandler(res).uploadImage(croppedBase64, "S_"+Date.now()));
        const obj = {
            id: currentEditId, name: document.getElementById('sName').value, lat: document.getElementById('sLat').value,
            lon: document.getElementById('sLon').value, addr: document.getElementById('sAddr').value, rad: document.getElementById('sRad').value, photoUrl: pUrl
        };
        google.script.run.withSuccessHandler(m => { alert(m); loadAdminData(); openStoreForm(false); btn.disabled = false; }).saveEntity('store', obj);
    }

    function editWorker(uid) {
        currentEditId = uid; openWorkerForm(true);
        google.script.run.withSuccessHandler(res => {
            document.getElementById('wInName').value = res.name;
            document.getElementById('wInPhone').value = res.phone;
            document.getElementById('wInRate').value = res.rate;
            document.getElementById('wInPBal').value = res.prevBal || 0;
            document.getElementById('wInPAdv').value = res.prevAdv || 0;
            document.getElementById('wInPhotoPrev').src = res.photoUrl || 'https://via.placeholder.com/100';
        }).getWorkerFullProfile(uid);
    }

    function editStore(id) {
        currentEditId = id; openStoreForm(true);
        google.script.run.withSuccessHandler(res => {
            if(!res) return;
            document.getElementById('sName').value = res.name;
            document.getElementById('sLat').value = res.lat;
            document.getElementById('sLon').value = res.lon;
            document.getElementById('sAddr').value = res.addr;
            document.getElementById('sRad').value = res.rad;
            document.getElementById('sInImagePrev').src = res.photoUrl || 'https://via.placeholder.com/300x120';
            if(map && res.lat) {
                const pos = [parseFloat(res.lat), parseFloat(res.lon)];
                map.setView(pos, 17);
                if(marker) map.removeLayer(marker);
                marker = L.marker(pos).addTo(map);
            }
        }).getStoreProfile(id);
    }

    function initMap() {
        if(map) return;
        const mapEl = document.getElementById('map');
        if(!mapEl) return;
        map = L.map('map').setView([23.8, 90.4], 13);
        L.tileLayer('https://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {subdomains:['mt0','mt1','mt2','mt3']}).addTo(map);
        map.on('click', e => {
            if(marker) map.removeLayer(marker);
            marker = L.marker(e.latlng).addTo(map);
            document.getElementById('sLat').value = e.latlng.lat.toFixed(6);
            document.getElementById('sLon').value = e.latlng.lng.toFixed(6);
        });
    }

    function locateMe() {
        navigator.geolocation.getCurrentPosition(pos => {
            const {latitude: lat, longitude: lon} = pos.coords;
            if(marker) map.removeLayer(marker);
            marker = L.marker([lat, lon]).addTo(map);
            map.setView([lat, lon], 17);
            document.getElementById('sLat').value = lat.toFixed(6);
            document.getElementById('sLon').value = lon.toFixed(6);
        });
    }

    function setupMonths() {
        const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
        const opt = months.map((m, i) => `<option value="${i}" ${i==new Date().getMonth()?'selected':''}>${m}</option>`).join('');
        const w = document.getElementById('wReportMonth'), a = document.getElementById('adminReportMonth');
        if(w) w.innerHTML = opt; if(a) a.innerHTML = opt;
    }

    function openWorkerForm(show) {
    const form = document.getElementById('workerForm');
    form.classList.toggle('hidden', !show);
    
    if (show) {
        // যদি নতুন ওয়ার্কার যোগ করার জন্য ক্লিক করা হয় (Edit মোডে না থাকলে)
        if (!currentEditId) {
            document.getElementById('wInName').value = "";
            document.getElementById('wInPhone').value = "";
            document.getElementById('wInRate').value = "";
            document.getElementById('wInPBal').value = "0";
            document.getElementById('wInPAdv').value = "0";
            document.getElementById('wInLimit').value = "7";
            document.getElementById('wInF').value = "10";
            document.getElementById('wInH').value = "5";
            document.getElementById('wInQ').value = "3";
            document.getElementById('wInJDate').value = new Date().toISOString().split('T')[0];
            document.getElementById('wInPhotoPrev').src = "https://via.placeholder.com/100";
            croppedBase64 = null; // ইমেজ ডাটা ক্লিয়ার
        }
    } else {
        // ফর্ম বন্ধ করার সময় আইডি ক্লিয়ার করা
        currentEditId = null;
        croppedBase64 = null;
    }
}

function openStoreForm(show) {
    const form = document.getElementById('storeForm');
    form.classList.toggle('hidden', !show);
    
    if (show) {
        if (!currentEditId) {
            document.getElementById('sName').value = "";
            document.getElementById('sLat').value = "";
            document.getElementById('sLon').value = "";
            document.getElementById('sAddr').value = "";
            document.getElementById('sRad').value = "20";
            document.getElementById('sInImagePrev').src = "https://via.placeholder.com/300x120";
            croppedBase64 = null;
        }
    } else {
        currentEditId = null;
        croppedBase64 = null;
    }
}

    
    function refreshSession() {
        if(!user) return;
        google.script.run.withSuccessHandler(res => {
            if(res.success) { user = res; localStorage.setItem('userSession', JSON.stringify(res)); renderDash(); }
        }).authenticate({type:'refresh', uid: user.uid});
    }

    function loadWorkerReport() {
     const m = document.getElementById('wReportMonth');
     if(!m || !user) return;
    
     // UI ক্লিন করা যাতে লোড হওয়ার সময় আগের ডাটা না দেখায়
     document.getElementById('statFull').innerText = "...";
    
     google.script.run.withSuccessHandler(res => {
        if(res.error) {
            console.error(res.error);
            return;
        }
        document.getElementById('statFull').innerText = res.full || 0;
        document.getElementById('statHalf').innerText = res.half || 0;
        document.getElementById('statQuarter').innerText = res.quarter || 0;
        document.getElementById('statHoliday').innerText = res.holiday || 0;
        document.getElementById('statAbsent').innerText = res.absent || 0;
     }).getMonthlyReportData(user.uid, m.value, new Date().getFullYear());
    }

    function loadAdminReport() {
        const m = document.getElementById('adminReportMonth');
        if(!m) return;
        google.script.run.withSuccessHandler(data => {
            document.getElementById('adminReportBody').innerHTML = data.map(r => `<tr><td>${r.name}</td><td>${r.full}/${r.half}/${r.quarter}/${r.absent}</td><td>₹${r.balance}</td></tr>`).join('');
        }).getAdminFullReport(m.value, new Date().getFullYear());
    }

    function changeLang() {
        const l = document.getElementById('langSelect').value;
        const t = trans[l] || trans.en;
        ['txtEarn','txtPaid','txtBal','txtMenu','txtRefresh','txtPin','txtLogout'].forEach(id => {
            let el = document.getElementById(id);
            if(el) el.innerText = t[id.replace('txt','').toLowerCase()];
        });
    }

    function promptPin() {
        const p = prompt("Enter New 4-Digit PIN:");
        if(p && p.length === 4) google.script.run.withSuccessHandler(alert).changePin(user.uid, p);
        else alert("Invalid PIN!");
    }

    // ট্যাব পরিবর্তন করার সময় যদি লিভ ট্যাব সিলেক্ট হয় তবে ডাটা লোড হবে
function switchTab(id) {
    document.querySelectorAll('.admin-tab').forEach(t => t.classList.add('hidden'));
    document.querySelectorAll('#adminTabs .nav-link').forEach(l => l.classList.remove('active'));
    document.getElementById(id).classList.remove('hidden');
    event.currentTarget.classList.add('active');
    
    if(id === 'tabStores') setTimeout(() => { if(map) map.invalidateSize(); }, 300);
    if(id === 'tabLeaves') loadAdminLeaves(); // লিভ ডাটা লোড হবে
}

function loadAdminLeaves() {
    google.script.run.withSuccessHandler(data => {
        const container = document.getElementById('pendingLeaveList');
        if(data.length === 0) {
            container.innerHTML = '<p class="text-muted small">No pending requests.</p>';
            document.getElementById('leaveBadge').classList.add('hidden');
            return;
        }
        
        // ব্যাজ আপডেট (কয়টি পেন্ডিং আছে)
        document.getElementById('leaveBadge').innerText = data.length;
        document.getElementById('leaveBadge').classList.remove('hidden');

        container.innerHTML = data.map(lv => `
            <div class="premium-card mb-2">
                <div class="d-flex justify-content-between">
                    <strong>${lv.name}</strong>
                    <small class="text-info">${lv.start} to ${lv.end}</small>
                </div>
                <p class="small text-muted mb-2">Reason: ${lv.reason}</p>
                <div class="d-flex gap-2">
                    <button class="btn btn-success btn-sm flex-grow-1" onclick="handleLeave('${lv.id}', 'Approved')">Approve (Paid)</button>
                    <button class="btn btn-outline-success btn-sm flex-grow-1" onclick="handleLeave('${lv.id}', 'Approved', 'Unpaid')">Approve (Unpaid)</button>
                    <button class="btn btn-danger btn-sm" onclick="handleLeave('${lv.id}', 'Rejected')">Reject</button>
                </div>
            </div>
        `).join('');
    }).getPendingLeaves();
}

function handleLeave(id, status, isPaid = "Paid") {
    if(!confirm(`Are you sure to ${status} this leave?`)) return;
    google.script.run.withSuccessHandler(res => {
        alert(res);
        loadAdminLeaves(); // লিস্ট রিফ্রেশ
    }).updateLeaveStatus(id, status, isPaid);
}

    function logout() {
        localStorage.removeItem('userSession');
        user = null;
        if(watchId) navigator.geolocation.clearWatch(watchId);
        document.getElementById('mainContent').classList.add('hidden');
        document.getElementById('loginPage').classList.remove('hidden');
        document.getElementById('phone').value = '';
        document.getElementById('pin').value = '';
        const loginBtn = document.getElementById('loginBtn');
        const adminBtn = document.getElementById('adminLoginBtn');
        if(loginBtn) { loginBtn.disabled = false; loginBtn.innerText = "WORKER LOGIN"; }
        if(adminBtn) { adminBtn.disabled = false; adminBtn.innerText = "ADMIN ACCESS"; }
    }

    function adminPay(u, n) { const a = prompt("Payment for "+n); if(a) google.script.run.withSuccessHandler(m=>{alert(m);loadAdminData();}).addPayment({uid:u, amount:a, desc:'Salary'}); }
    function downloadReport() {
        let csv = "Name,Attendance,Balance\n";
        document.querySelectorAll('#adminReportBody tr').forEach(tr => {
            let rowData = []; tr.querySelectorAll('td').forEach(td => rowData.push(td.innerText.replace('₹','')));
            csv += rowData.join(',') + "\n";
        });
        const link = document.createElement("a");
        link.href = "data:text/csv;charset=utf-8," + encodeURI(csv);
        link.download = "Report.csv"; link.click();
    }

    function showLeaveModal() {
    document.getElementById('leaveModal').classList.remove('hidden');
}

function submitMyLeave() {
    const obj = {
        uid: user.uid,
        name: user.name,
        startDate: document.getElementById('lvStart').value,
        endDate: document.getElementById('lvEnd').value,
        reason: document.getElementById('lvReason').value
    };
    if(!obj.startDate || !obj.reason) return alert("Fill all details");
    
    google.script.run.withSuccessHandler(res => {
        alert(res);
        document.getElementById('leaveModal').classList.add('hidden');
    }).submitLeave(obj);
}

function downloadMySlip() {
    const m = document.getElementById('wReportMonth').value;
    const y = new Date().getFullYear();
    
    // বাটন হ্যান্ডলিং (আইকন থাকলেও কাজ করবে)
    const btn = document.querySelector('[onclick="downloadMySlip()"]');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Generating...';
    btn.disabled = true;

    google.script.run
        .withSuccessHandler(url => {
            btn.innerHTML = originalText;
            btn.disabled = false;
            
            if (!url) {
                alert("Error: No URL returned from server.");
                return;
            }
            
            if (url.toString().includes("Error")) {
                alert("Server Error: " + url);
            } else {
                // সরাসরি নতুন ট্যাবে PDF ওপেন হবে
                const win = window.open(url, '_blank');
                if (!win) {
                    alert("Please allow popups for this site to download the slip.");
                }
            }
        })
        .withFailureHandler(err => {
            btn.innerHTML = originalText;
            btn.disabled = false;
            alert("Execution Error: " + err.message);
        })
        .generatePaySlip(user.uid, m, y);
}

// এডমিন প্যানেলের জন্য পেন্ডিং লিভ চেক করার ফাংশন (Admin Tab এ যোগ করতে হবে)
function loadPendingLeaves() {
    google.script.run.withSuccessHandler(data => {
        // এই ডাটা দিয়ে এডমিনকে একটি লিস্ট দেখান যেখানে Approve/Reject বাটন থাকবে
        console.log("Pending Leaves:", data);
    }).getPendingLeaves();
}

    // --- ক্যালেন্ডার ও ছুটি রেন্ডার ফাংশন (Index.html script এর ভেতর) ---
    function renderHolidayCalendar(uid) {
        const container = document.getElementById('holidayCalendarContainer');
        if(!container) return;
        google.script.run.withSuccessHandler(holidays => {
            let html = '<div class="calendar-grid">';
            let now = new Date();
            let currentYear = now.getFullYear();
            let currentMonth = now.getMonth();
            let daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
            for(let d = 1; d <= daysInMonth; d++){
                let dateStr = `${currentYear}-${(currentMonth + 1).toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}`;
                let h = holidays.find(x => x.date === dateStr);
                let cls = h ? 'bg-holiday' : '';
                html += `<div class="calendar-day ${cls}" title="${h ? h.note : ''}" onclick="if('${h?h.note:''}') alert('${h?h.note:''}')">${d}</div>`;
            }
            html += '</div>';
            container.innerHTML = html;
        }).getWorkerHolidays(uid);
    }


  // Index.html এর script ট্যাগের ভেতর এটি রিপ্লেস করুন
function setHoliday(uid) {
    let date = prompt("Enter Date (YYYY-MM-DD):", new Date().toISOString().split('T')[0]);
    if(!date) return;

    let target = confirm("Click OK for EVERYONE (Global) \nClick CANCEL for this worker only (Individual)");
    let finalUid = target ? "ALL" : uid;

    let isPaid = confirm("Click OK for PAID Holiday (Salary included) \nClick CANCEL for UNPAID Holiday (Salary cut)");
    let finalStatus = isPaid ? "Paid" : "Unpaid";

    let note = prompt("Enter Holiday Reason (e.g. Eid, Sick Leave):");
    if(!note) note = "Holiday";

    google.script.run.withSuccessHandler(m => { 
        alert(m); 
        loadAdminData(); 
    }).saveHoliday({
        uid: finalUid, 
        date: date, 
        note: note, 
        status: finalStatus
    });
}
