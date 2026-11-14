# Toolsmith Code Architecture

Dokumen ini adalah pedoman arsitektur dan konvensi implementasi backend Toolsmith. Kode baru harus mengikuti aturan di sini, kecuali ada keputusan arsitektur yang secara eksplisit menggantikannya.

Dokumen ini menjadi acuan yang relatif stabil untuk batas modul, tanggung jawab file, aliran eksekusi tool, keamanan, lifecycle, pengujian, dan refactor. Dokumen ini bukan changelog, daftar tugas, dokumentasi setiap endpoint, atau instruksi deployment. Cara menjalankan proyek ada di `README.md`; rencana kerja ada di `PLAN.md` dan/atau `TODO.md`; desain dan keputusan khusus dapat disimpan di `DESIGN.md` atau `docs/`.

## 1. Prinsip utama

1. Kelompokkan kode berdasarkan domain/tanggung jawab, bukan menumpuk seluruh implementasi di satu file.
2. Setiap file harus memiliki tanggung jawab yang jelas dan nama yang menjelaskan fungsinya.
3. Pisahkan definisi tool, validasi input, policy enforcement, implementasi capability, dan transport.
4. Semua tool yang dapat dipanggil pengguna harus melewati `registerExposedTool()`; jangan membuat jalur eksekusi yang melewati exposure, permission, approval, dan logging.
5. Backend adalah batas keamanan. UI Console hanya klien dan tidak boleh menjadi satu-satunya tempat penegakan akses.
6. Perlakukan input tool, path, command, URL, session ID, metadata klien, dan data eksternal sebagai input tidak tepercaya.
7. Semua proses eksternal dan resource berumur panjang harus memiliki pemilik, batas waktu, mekanisme pembatalan, penanganan output, dan aturan cleanup.
8. Jangan mengklaim eksekusi shell sebagai sandbox. Working directory hanya menentukan direktori awal, bukan membatasi akses filesystem atau proses.
9. Hindari abstraksi dan lapisan yang dibuat hanya demi pola. Tambahkan controller/service/repository jika tanggung jawab dan kompleksitasnya memang membutuhkan.
10. Perubahan struktur harus menjaga kontrak MCP/API, format konfigurasi, data yang sudah tersimpan, dan kompatibilitas deployment kecuali migrasi direncanakan secara eksplisit.

## 2. Struktur direktori

Struktur aktual setelah reorganisasi domain backend dan pemisahan UI internal:

```text
toolsmith/
├── src/
│   ├── index.ts                  # entrypoint proses
│   ├── app.ts                    # composition root: transport, HTTP dispatch, lifecycle
│   ├── app/
│   │   └── http.ts               # MCP Streamable HTTP session/transport lifecycle
│   ├── modules/
│   │   ├── auth/                 # admin authentication, OAuth, auth HTTP endpoints
│   │   ├── mcp/                  # MCP server dan tool protocol adapters
│   │   │   └── tools/
│   │   ├── dashboard/            # HTTP API untuk Toolsmith Console terpisah
│   │   ├── terminal/             # lifecycle terminal dan WebSocket I/O
│   │   ├── process/              # registry lifecycle subprocess milik Toolsmith
│   │   ├── tunnels/              # lifecycle proses Cloudflare Quick Tunnel
│   │   ├── approval/             # state approval, keputusan, pembatalan
│   │   ├── computer/             # capability komputer per OS
│   │   │   ├── linux/
│   │   │   ├── macos/
│   │   │   └── windows/
│   │   ├── filesystem/           # operasi filesystem reusable
│   │   └── system/               # informasi host
│   ├── control-plane/
│   │   ├── db/                   # koneksi SQLite, schema, migrations
│   │   ├── tools/                # katalog, exposure, permission, custom rules
│   │   ├── logs/                 # persistensi log pemanggilan tool
│   │   ├── workspace/            # operasi metadata/workspace
│   │   └── root-commands.ts      # aturan allowlist perintah privileged
│   ├── ui/                       # SvelteKit UI internal Toolsmith, bukan Console
│   │   ├── lib/components/
│   │   ├── routes/
│   │   └── static/
│   └── lib/                      # utilitas lintas domain yang kecil dan stabil
├── tests/
├── ARCHITECTURE.md
├── README.md
└── package.json
```

src/ui/ dibangun sebagai static SPA ke dist/ui/ dan disajikan oleh HTTP server Bun yang sama. Toolsmith tetap satu executable/service. src/modules/dashboard/ hanya API backend untuk proyek Toolsmith Console terpisah; jangan pindahkan frontend Console ke repository ini.

Kelompokkan seluruh fitur backend berdasarkan domain di src/modules/. src/control-plane/ tetap menjadi infrastruktur persistensi dan policy, bukan tempat implementasi capability OS. Jangan membuat folder kosong atau memindahkan file hanya untuk mencocokkan diagram.

## 3. Batas tanggung jawab

| Komponen | Tanggung jawab | Hindari |
|---|---|---|
| src/index.ts | Entrypoint yang memanggil composition root dan memasang signal handler | Implementasi transport atau routing |
| src/app.ts | Menginisialisasi transport, merutekan request, menyatukan modul, dan mengelola graceful shutdown | Implementasi domain atau query database |
| src/app/http.ts | Membuat dan menutup session MCP HTTP, menghubungkan request dengan transport | Implementasi tool atau endpoint dashboard |
| src/modules/mcp/server.ts | Membuat instance MCP server dan menginisialisasi registrasi tool | Logika transport HTTP tingkat proses |
| src/modules/mcp/tools/*.ts | Mendefinisikan schema, metadata, dan handler untuk grup tool | Mem-bypass policy wrapper atau menampung logika lintas domain yang besar |
| src/modules/mcp/tools/register.ts | Satu enforcement point untuk exposure, permission, custom rules, approval, dan call logging | Menjadi tempat implementasi bisnis semua tool |
| src/control-plane/tools/ | Katalog tool, konfigurasi exposure, permission, aturan custom, schema input | Menjalankan capability OS atau terminal secara langsung |
| src/control-plane/db/ | Koneksi SQLite, schema Drizzle, dan migration | Aturan bisnis khusus satu tool |
| src/modules/auth/ | Admin authentication, OAuth protocol endpoints, dan penyajian UI internal | Menyimpan markup halaman sebagai string HTML |
| src/modules/dashboard/ | Handler API yang dipakai Toolsmith Console | Menyajikan frontend Console atau menganggap UI sebagai sumber otorisasi |
| src/modules/terminal/ | Membuat, melacak, mengirim input/output, dan menghentikan sesi terminal | Mengelola proses yang tidak dibuat atau dimiliki Toolsmith |
| src/modules/process/ | Registry lifecycle subprocess yang dimiliki Toolsmith | Mengelola proses asing |
| src/modules/tunnels/ | Mengelola lifecycle proses tunnel dan API terkait | Menyimpan lifecycle proses di handler MCP terpisah |
| src/modules/approval/ | State approval, keputusan, dan pembatalan yang dapat dipakai wrapper tool | Mengandalkan keputusan dari frontend tanpa verifikasi server |
| src/modules/computer/ | Adaptor capability komputer per OS | Mengekspos fungsi OS yang belum didukung atau belum diuji |
| src/modules/filesystem/, src/modules/system/ | Capability filesystem dan informasi host | Mencampur implementasi domain dengan transport |
| src/ui/ | SvelteKit UI internal: setup, login, OAuth authorization, dan halaman administrasi | Menjadi frontend Toolsmith Console |
| src/lib/ | Utilitas lintas domain yang kecil dan stabil | Menjadi folder serba-ada untuk logika fitur |
| tests/ | Regression, unit, dan integration tests | Mengakses database/port produksi atau bergantung pada urutan test |

### Aturan pemisahan API dan use case

Toolsmith bukan backend CRUD bisnis biasa. Karena itu, tidak semua handler harus memiliki pasangan controller, service, dan repository.

- Handler MCP menjadi adaptor protokol: menerima input tervalidasi, memanggil capability/use case, lalu membentuk hasil MCP.
- Logika yang memiliki aturan atau lifecycle sendiri dipindahkan ke fungsi/modul domain yang dapat diuji secara terpisah.
- Akses SQLite melalui lapisan control-plane yang sesuai; jangan menyebarkan query database ke handler tool atau dashboard.
- Handler dashboard bertugas memvalidasi method/path/auth, memanggil use case yang sesuai, dan membentuk respons HTTP. Jika sebuah handler tumbuh besar, pecah logika ke modul domain, bukan menambah abstraksi kosong.
- Repository terpisah masuk akal untuk operasi database yang kompleks, digunakan lintas handler, atau perlu diuji/ditransaksikan secara mandiri. Tidak perlu membuat repository untuk setiap tabel secara otomatis.

## 4. Aliran pemanggilan tool

```text
MCP Client
    ↓
MCP transport (STDIO atau Streamable HTTP)
    ↓
MCP Server dan tool registry
    ↓
registerExposedTool()
    ├── memastikan konfigurasi dan schema input
    ├── memeriksa exposure
    ├── mengevaluasi permission dan custom rules
    ├── meminta approval jika dibutuhkan
    ├── menjalankan handler setelah diizinkan
    └── mencatat hasil pemanggilan
    ↓
Tool handler
    ↓
Capability / use case
    ├── filesystem
    ├── terminal / process registry
    ├── computer
    ├── system
    ├── tunnel
    └── root command
    ↓
Hasil MCP
```

Aturan wajib:

- Semua tool yang dapat dipanggil pengguna harus diregistrasikan melalui `registerExposedTool()`.
- Jangan menduplikasi atau melewati policy enforcement di handler tertentu.
- Anotasi read-only harus akurat, tetapi anotasi tidak menggantikan validasi path, izin, dan input.
- Perubahan tool perlu memeriksa konsistensi antara registrasi MCP, katalog control-plane, metadata risiko, dan tes katalog API.
- Ketika tool dihapus, hapus implementasi, import, registrasi, metadata, referensi kebijakan khusus, dan test expectation yang sudah tidak relevan. Pastikan tidak ada caller aktif sebelum menghapus file.

## 5. HTTP API dan dashboard

- MCP endpoint, internal control API, dan dashboard API adalah permukaan yang berbeda walaupun berbagi proses server.
- Endpoint internal harus melewati autentikasi yang sesuai. Jangan menganggap request dari Console otomatis tepercaya.
- Validasi method, path, input, dan otorisasi dilakukan di server.
- Perubahan kontrak API harus memperbarui handler, auth/method checks, test, dan dokumentasi secara bersamaan.
- src/modules/dashboard/ menyediakan API yang dikonsumsi proyek Toolsmith Console terpisah; perubahan kontrak mungkin memerlukan perubahan dan pengujian di repository Console.
- Jangan menambahkan endpoint dashboard dengan menyisipkan logika bisnis panjang ke dispatcher utama. Pecah handler berdasarkan area fungsional.
- Respons error harus konsisten dan tidak membocorkan stack trace, token, password, secret, atau detail internal.

## 6. Permission, approval, dan keamanan

- Server merupakan sumber kebenaran untuk exposure dan izin eksekusi.
- Default harus fail-closed untuk operasi yang berisiko ketika status izin tidak dapat dipastikan.
- Operasi yang mengubah state atau berdampak pada host harus memiliki anotasi risiko dan approval behavior yang sesuai.
- Custom permission rules tidak menggantikan validasi input atau pemeriksaan izin dasar.
- Root command hanya boleh dijalankan melalui mekanisme allowlist yang ketat; pencocokan harus mempertimbangkan command dan argumen sesuai aturan yang berlaku.
- Jangan mengirim secret, password, authorization header, OAuth code, atau payload sensitif ke log.
- Jangan menganggap working directory sebagai sandbox.
- Tool yang menerima path harus menangani path traversal, symlink, direktori kerja, dan batas akses sesuai capability yang dijanjikan.
- Tool yang menerima URL perlu mempertimbangkan akses jaringan internal dan tujuan yang tidak tepercaya sesuai fungsi tool tersebut.
- Untuk operasi yang memiliki efek samping, uji setidaknya skenario allow, approval, deny/block, timeout, dan cancellation jika berlaku.

## 7. Proses eksternal dan lifecycle

Setiap subprocess harus memiliki:

1. Pemilik lifecycle yang jelas.
2. Batas waktu atau alasan eksplisit mengapa proses berjalan lama.
3. Batas output dan penanganan stream.
4. Perilaku abort/cancellation yang terdokumentasi.
5. Penanganan exit code, error, dan penutupan stream.
6. Cleanup ketika sukses, gagal, timeout, abort, dan shutdown.

Aturan tambahan:

- Proses background harus diregistrasikan dan memiliki semantik stop yang jelas.
- Subprocess bash, eval, sudo_exec, terminal, dan tunnel yang dikelola didaftarkan ke src/modules/process/; pemilik aslinya tetap bertanggung jawab untuk stop, exit, dan cleanup.
- Process Monitor hanya menampilkan proses yang didaftarkan oleh instance Toolsmith aktif. Registry bersifat in-memory; riwayat tidak dipulihkan setelah restart dan PID dari proses lain tidak boleh dihentikan.
- Resource Linux dibaca dari /proc; metrik yang tidak tersedia pada OS lain harus ditampilkan sebagai tidak tersedia, bukan diperkirakan.
- Hanya kirim signal ke process group yang dibuat dan dimiliki Toolsmith.
- Terminal shutdown harus menghentikan sesi yang dikelola, menutup WebSocket, menunggu proses keluar dalam batas waktu, lalu melakukan force-kill hanya sebagai fallback.
- Shutdown harus idempotent dan menghentikan penerimaan pekerjaan baru sebelum melepas resource.
- Session MCP HTTP harus ditutup dan dibersihkan dari registry ketika transport ditutup atau proses shutdown.
- Jangan menyimpulkan memory leak hanya dari nama atau usia worker. Ukur PID, RSS/PSS, jumlah proses/thread, cgroup memory, dan beban kerja.

## 8. Database dan konfigurasi

### SQLite dan migration

- Schema database didefinisikan melalui Drizzle di `src/control-plane/db/schema.ts`.
- Setiap perubahan schema wajib memiliki migration yang ditinjau.
- Jangan mengedit data produksi manual sebagai pengganti migration.
- Tes harus menggunakan `NODE_ENV=test` dan direktori data terisolasi. Jangan pernah mengarahkan test ke database produksi atau direktori data produksi.
- Pertahankan data, ownership, path, dan format lama selama transisi branding/deployment sampai prosedur migrasi dan rollback tervalidasi.

### Environment

- `src/lib/config.ts` adalah titik konfigurasi terpusat untuk environment aplikasi.
- Konfigurasi aplikasi menggunakan variabel `TOOLSMITH_*` dan konfigurasi MCP yang didokumentasikan di README.md.
- Direktori data produksi menggunakan `/var/lib/toolsmith` kecuali `TOOLSMITH_DATA_DIR` ditentukan.
- Secret hanya berasal dari environment atau secret manager, bukan source code.
- Perubahan encryption key dapat membuat data terenkripsi lama tidak dapat dibaca; jangan merotasinya tanpa rencana migrasi.
- Variabel environment yang didokumentasikan harus benar-benar digunakan; hapus variabel yang tidak terpakai hanya setelah memastikan tidak dibutuhkan oleh deployment.

## 9. Konvensi kode dan import

- File dan folder menggunakan `kebab-case`; variabel dan fungsi menggunakan `camelCase`; tipe menggunakan `PascalCase`; konstanta sungguhan menggunakan `UPPER_SNAKE_CASE`.
- Gunakan nama yang menjelaskan tindakan dan domain. Hindari `utils.ts`, `helpers.ts`, atau `manager.ts` yang menampung fungsi tidak berkaitan.
- Pertahankan pola import yang konsisten dalam satu area kode. Jangan menambah alias path baru sebelum kebutuhan dan konfigurasi TypeScript/Bun disepakati.
- Hapus import, export, tipe, konstanta, dan implementasi yang tidak lagi digunakan setelah perubahan.
- Jangan mempertahankan abstraction layer hanya karena pernah ada. Namun, sebelum menghapus file, cari semua referensi dan periksa dynamic import, registrasi, test, serta pemanggilan lintas modul.
- Jangan menambahkan dependency jika fungsi yang sama sudah tersedia di runtime atau dependency yang ada tanpa alasan teknis yang kuat.

## 10. Pengujian dan pemeriksaan

- Unit test untuk fungsi deterministik dan aturan domain yang bisa diuji tanpa menjalankan server.
- Integration test untuk kontrak HTTP/MCP, persistence, permission, approval, dan lifecycle.
- Test yang membuat file atau direktori sementara harus membersihkan artefaknya setelah test selesai, termasuk saat test gagal.
- HTTP integration test memakai port loopback khusus dan kredensial test.
- Jangan menguji dengan database, port, token, atau layanan produksi.
- Perubahan permission/approval harus menguji jalur diizinkan dan ditolak, bukan hanya jalur sukses.
- Perubahan proses harus menguji timeout, abort, output cap, exit handling, dan cleanup yang relevan.
- Sebelum perubahan dianggap selesai, jalankan:

```sh
bun run typecheck
bun test
bun run build
git diff --check
```

Jika salah satu pemeriksaan tidak dapat dijalankan, jelaskan alasannya dan jangan menyatakan validasi lengkap.

## 11. Strategi refactor

Refactor dilakukan bertahap, dengan perubahan perilaku dipisahkan dari perubahan struktur sebisa mungkin.

1. **Dead code dan konsistensi registry** — hapus kode yang tidak digunakan, import mati, tipe/ekspor yatim, dan referensi tool yang sudah dihapus. Pastikan katalog MCP dan control-plane tetap konsisten.
2. **Pemetaan domain** — identifikasi dependensi antara tool handlers, dashboard, control-plane, terminal, approval, dan tunnels sebelum memindahkan file.
3. **Pecah handler yang terlalu besar** — pindahkan logika domain/lifecycle ke modul yang memiliki nama dan tanggung jawab spesifik; jangan membuat lapisan kosong.
4. **Kurangi coupling dashboard** — pastikan API dashboard menggunakan operasi control-plane/domain yang sama untuk keputusan izin dan data yang sama, tanpa menduplikasi policy.
5. **Perjelas lifecycle** — audit ownership dan cleanup MCP session, subprocess, terminal, WebSocket, dan tunnel.
6. **Perkuat regression tests** — tambahkan tes sebelum refactor untuk perilaku sensitif, lalu jalankan seluruh test setelah setiap kelompok perubahan.
7. **Baru pertimbangkan restrukturisasi folder besar** setelah dependensi dan batas modul jelas. Jangan menggabungkan refactor folder besar, perubahan kontrak API, dan migrasi data dalam satu langkah.

Setiap tahap harus mempertahankan perilaku yang tidak sedang sengaja diubah. Jangan melakukan commit, publish, atau deployment kecuali diminta secara eksplisit.

## 12. Batas deployment dan kompatibilitas

- Instalasi yang didukung menggunakan CLI per-user, direktori `~/.toolsmith`, dan `toolsmith.service` pada systemd user manager.
- Jangan menjalankan target install/update/uninstall/purge, perintah systemd, migration produksi, atau deployment sebagai bagian dari pengujian lokal.
- Validasi migrasi deployment di lingkungan non-produksi dan siapkan rollback sebelum menyentuh instalasi yang sudah berjalan.

## 13. Pemeliharaan dokumen

Perbarui dokumen ini jika batas modul, struktur direktori, kebijakan keamanan, lifecycle, atau konvensi implementasi berubah secara sengaja. Penambahan tool atau test biasa tidak otomatis membutuhkan perubahan arsitektur.

Simpan cara setup dan konfigurasi pengguna di `README.md`, rencana pekerjaan di `PLAN.md`/`TODO.md`, serta desain atau keputusan khusus di `DESIGN.md` atau `docs/`.
