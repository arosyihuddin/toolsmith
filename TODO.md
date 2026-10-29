# TODO — Toolsmith

> Dokumen kerja untuk audit lifecycle proses, pengurangan resource, dan rebranding proyek agar tidak lagi bergantung pada identitas Oh My Pi (OMP).
>
> **Nama kerja yang dipilih:** **Toolsmith** untuk backend/tooling dan **Toolsmith Console** untuk dashboard pendamping. Nama repository yang diusulkan: `toolsmith` dan `toolsmith-console`. Nama masih perlu diperiksa terhadap konflik proyek, package, domain, dan merek sebelum publikasi.
>
> **Batas aman:** audit dan implementasi lokal terlebih dahulu. Jangan mengubah service production, menghentikan proses production, mengganti nama unit systemd, memindahkan direktori `/opt/omp-mcp` atau `/var/lib/omp-mcp`, mengubah domain, maupun deploy tanpa persetujuan eksplisit.

## Status awal

- [x] Memeriksa service `omp-mcp.service` dan proses di cgroup pada saat audit.
- [x] Mengonfirmasi tidak ditemukan proses berstatus zombie di cgroup service pada saat pemeriksaan.
- [x] Menemukan proses yang berumur panjang di cgroup: server utama, worker JS eval, daemon broker, shell interaktif `fish`, dan PostgreSQL lokal beserta proses anaknya. Belum terbukti semua proses tersebut bocor atau berasal dari pemanggilan tool tertentu.
- [x] Menemukan bahwa terminal interaktif dibuat dengan `Bun.spawn([shell, "-i"])`, memiliki `dispose(id)`, tetapi belum memiliki cleanup massal saat shutdown.
- [x] Menemukan bahwa shutdown utama menutup HTTP server, tunnel, sesi MCP, dan runtime native dalam mode agent, tetapi belum memanggil cleanup semua terminal.
- [ ] Belum mengukur apakah jumlah worker bertambah setelah pemanggilan tool berulang.
- [ ] Belum membuktikan proses PostgreSQL lokal yang tertinggal dibuat oleh tool OMP-MCP.
- [x] Backend sekarang hanya memakai native Toolsmith tools; tidak ada deployment atau service production yang sengaja diubah/restarted.

## Fase 1 — Perbaikan lifecycle proses

### 1.1 Terminal interaktif

- [x] Tambahkan `terminalManager.disposeAll()` di `src/terminal/index.ts`; menutup seluruh terminal terdaftar, menunggu exit, lalu memakai SIGKILL sebagai fallback setelah batas waktu.
- [x] Panggil cleanup terminal dalam shutdown `src/index.ts` sebelum runtime native/server ditutup; shutdown juga dibuat idempotent.
- [x] Buat cleanup menunggu proses keluar dengan batas waktu; gunakan SIGKILL hanya sebagai fallback.
- [x] Cleanup terminal toleran terhadap error saat PTY/proses ditutup dan menutup WebSocket client; tes disposeAll dan cleanup kosong sudah ditambahkan. Masih perlu tes terminal yang sudah exited secara alami.
- [x] Terminal memakai process group terpisah dan cleanup memberi sinyal hanya ke process group yang dimiliki terminal; tes regression memverifikasi child shell ikut berhenti.
- [x] Tambahkan tes untuk disposeAll multi-terminal, cleanup idempotent, dan penghentian child process. Tes proses exited alami masih perlu dilengkapi.

**Acceptance:** shutdown menutup semua terminal yang dikelola server; proses yang dikelola terminal tidak tertinggal; cleanup idempotent dan tidak menggantung tanpa batas.

### 1.2 Command dan subprocess

- [ ] Audit seluruh penggunaan `Bun.spawn`, `spawn`, `exec`, shell, dan proses background di `src/`.
- [x] Perbaiki `src/filesystem/search.ts`: tangani signal yang sudah aborted, eskalasi SIGTERM ke SIGKILL saat perlu, tunggu proses keluar, dan konsumsi stdout/stderr.
- [x] Audit awal `src/computer/linux/apps.ts`: stdout, stderr, dan `proc.exited` sudah ditunggu bersama lewat `Promise.all`; belum ada perubahan diperlukan pada helper ini.
- [ ] Audit tool `bash` Lite: timeout, pembatalan MCP, sinyal shutdown, buffer output, error spawn, dan proses anak. Hindari mengklaim `cwd` sebagai sandbox; shell tetap bisa mengakses filesystem dan menjalankan proses lain.
- [ ] Tentukan kebijakan eksplisit untuk command background. Proses yang sengaja diminta berjalan di background harus dilaporkan/ditrack, bukan dianggap proses sementara yang otomatis aman dibunuh.
- [ ] Tambahkan helper subprocess bersama bila pola cleanup memang konsisten; jangan membuat abstraksi generik sebelum audit menunjukkan kebutuhan.

**Acceptance:** semua subprocess sementara ditunggu dan dibersihkan pada sukses, error, timeout, abort, dan shutdown; proses background yang disengaja memiliki lifecycle yang jelas.

### 1.3 Runtime native dan worker

- [x] Menghapus runtime agent legacy beserta registrasi tools dinamisnya; Toolsmith sekarang hanya menggunakan implementasi native tools sendiri.
- [ ] Identifikasi pemilik dan lifecycle worker `__omp_worker_js_eval_process` serta `__omp_worker_daemon_broker` melalui dokumentasi/runtime dan pengukuran; jangan mengasumsikan worker aktif adalah zombie atau memory leak.
- [ ] Ukur jumlah PID, RSS/PSS, thread, dan cgroup `MemoryCurrent` sebelum/sesudah beberapa siklus pemanggilan tool, idle, pembatalan, serta shutdown.
- [ ] Bedakan proses yang memang singleton/long-lived dari proses yang terus bertambah.

**Acceptance:** ada hasil pengukuran yang dapat diulang, dan jumlah proses tidak tumbuh tanpa batas setelah siklus tool selesai.

## Fase 2 — Native toolchain dan pengujian resource

- [x] Tambahkan metadata katalog control-plane untuk tool Lite: `read`, `write`, `edit`, `bash`, `find`, dan `grep`.
- [x] Hapus mode agent legacy dan dependency Oh My Pi; server hanya mendaftarkan native Toolsmith tools.
- [ ] Tambahkan tes pembatalan MCP dan deny/block. Tes HTTP mencakup read/write/edit/find/grep/bash, approval, dan timeout bash.
- [x] Jalur startup tidak lagi mengimpor runtime agent; source dan dependency agent legacy sudah dihapus.
- [x] Typecheck, build, dan tes aktif lolos: 32 pass, 1 skip. Tes HTTP memakai port dan kredensial terisolasi.
- [x] Snapshot startup dev/test lokal: Lite sekitar 77,720 KiB RSS dan agent sekitar 321,516 KiB RSS, masing-masing 1 PID server terlihat pada snapshot. Ini hanya pengukuran singkat RSS, bukan PSS/cgroup atau baseline production; workload belum sepenuhnya setara.
- [ ] Dokumentasikan angka baseline, metode pengukuran, serta keterbatasan. Target RAM di bawah 50 MiB belum boleh diklaim sebelum terukur.

**Acceptance:** semua tes yang relevan lolos; tidak ada regresi permission/approval; hasil resource direkam; tidak ada pengujian yang menyentuh service production.

## Fase 3 — Rebranding OMP → Toolsmith

### 3.1 Keputusan identitas

- [x] Memilih nama kerja **Toolsmith** untuk proyek backend dan **Toolsmith Console** untuk dashboard/control plane pendamping.
- [ ] Validasi nama **Toolsmith** dan **Toolsmith Console** terhadap konflik proyek/package/domain dan ketersediaan repository sebelum rilis publik.
- [x] Deskripsi produk dan package metadata lokal menggunakan Toolsmith serta Toolsmith Console; nama repository/folder Git belum diganti.
- [ ] Rekomendasi nama repository: `toolsmith`; dashboard/control plane pendamping: `toolsmith-console`.
- [x] README dan deskripsi package menjelaskan native MCP toolchain, bukan runtime Oh My Pi.

### 3.2 Audit referensi lama

- [ ] Cari semua referensi `OMP`, `omp-mcp`, `omp-control`, `Oh My Pi`, `@oh-my-pi/pi-coding-agent`, dan prefiks `omp_` di source, tests, dokumentasi, Makefile, script deploy, konfigurasi, dan metadata.
- [ ] Klasifikasikan tiap referensi: identitas produk yang harus diganti, konfigurasi lama yang perlu migrasi, atau kompatibilitas yang memang harus dipertahankan sementara.
- [x] Package metadata/lockfile, README, ARCHITECTURE, runtime logs, server identity, dan Console UI sudah direbrand. Installer, Makefile, systemd templates, serta deployment docs lama sengaja dipertahankan sampai migrasi non-production diuji.
- [ ] Hapus dependency `@oh-my-pi/pi-coding-agent` hanya setelah mode agent benar-benar dihapus dan tidak ada import atau kontrak yang masih bergantung padanya.
- [x] Menghapus OMP_NATIVE_MODE bersama mode agent; variabel runtime baru memakai prefix TOOLSMITH_* dengan fallback OMP_* untuk kompatibilitas.
- [ ] Tentukan nama baru untuk data directory, service systemd, executable path, dan file konfigurasi. Migrasi data harus mempertahankan database, token, key enkripsi, permission, serta ownership.
- [x] Branding/package/docs Toolsmith Console diperbarui; event browser, localStorage instance keys, dan nama Cloudflare D1 dipertahankan untuk kompatibilitas.
- [ ] Putuskan apakah endpoint/field lama dipertahankan sebagai compatibility alias untuk satu siklus rilis atau dihapus pada breaking release.

### 3.3 Deployment dan migrasi

- [ ] Buat rencana migrasi dari `/opt/omp-mcp` dan `/var/lib/omp-mcp` ke lokasi baru; jangan memindahkan atau menghapus direktori production sebelum backup dan rollback diuji.
- [ ] Buat rencana transisi systemd unit dan optional Browser Relay/desktop integration bila masih dibutuhkan.
- [ ] Pastikan token API dan `OMP_SUDO_ENCRYPTION_KEY` (atau penggantinya) tidak berubah/hilang saat migrasi; rahasia tidak boleh masuk Git atau log.
- [ ] Perbarui domain, reverse proxy, Cloudflare Tunnel, allowlist MCP, dan dokumentasi client hanya setelah daftar dependensi terpetakan.
- [ ] Sediakan prosedur backup, cutover, health check, rollback, dan penghapusan unit lama setelah stabil.
- [ ] Uji instalasi baru dan upgrade dari instalasi lama pada environment non-production.

**Acceptance:** tidak ada referensi OMP yang tersisa pada permukaan produk yang sudah direbrand, kecuali compatibility/migration notes yang sengaja dipertahankan; upgrade/rollback terdokumentasi dan teruji.

## Fase 4 — Dokumentasi dan rilis

- [ ] Tulis README baru yang menjelaskan tujuan, tools, transport MCP, permission/approval, instalasi, konfigurasi, dan batas keamanan.
- [ ] Perbarui ARCHITECTURE dan dokumentasi deployment berdasarkan arsitektur yang benar-benar dipakai setelah Lite stabil.
- [ ] Hapus instruksi instalasi dan fitur OMP yang sudah tidak relevan.
- [ ] Jalankan pencarian akhir untuk nama lama, typecheck, build, test, pemeriksaan diff, serta tes instalasi/upgrade.
- [ ] Buat changelog yang menjelaskan breaking changes dan jalur migrasi.
- [ ] Commit dan rilis hanya setelah diminta/diotorisasi; jangan deploy otomatis sebagai bagian dari rebranding.

## Urutan pengerjaan yang disarankan

1. Selesaikan audit subprocess/background dan ukur worker/resource secara berulang di dev.
2. Tambahkan tes pembatalan MCP dan proses terminal yang exited alami.
3. Validasi nama Toolsmith/Toolsmith Console untuk rilis publik.
4. Uji migrasi install/service/data path di environment non-production.
5. Ajukan rencana cutover dan rollback untuk persetujuan sebelum menyentuh production.
