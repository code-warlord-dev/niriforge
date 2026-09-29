# Спецификация: Фаза 4 — Packaging & 1.0

## Цель

Сделать NiriForge удобно устанавливаемым и production-ready.

---

## Packaging

### Arch Linux / CachyOS

- `PKGBUILD` (git-версия + release-версия).
- Зависимости: niri (опционально runtime), webkit2gtk/tauri deps.
- Desktop entry + icon.
- Конфликт с возможными старыми пакетами (если будут).

### AppImage

- Универсальный бинарь для других distro.
- Включить все необходимые libraries где возможно.

### Дополнительно (nice-to-have)

- Flatpak (если будет спрос).
- deb (Ubuntu/Debian).

---

## Документация пользователя

- Быстрый старт.
- Описание всех страниц GUI.
- FAQ (multi-file, Noctalia, Home Manager, symlink, "почему validate упал").
- Troubleshooting.
- Миграция с NiriMod / ручного конфига.

---

## Тестирование

- Unit-тесты schema + KDL round-trip.
- Integration-тесты на наборе реальных конфигов (в т.ч. CachyOS, Noctalia-style, сложные multi-file).
- Smoke-тест UI (опционально Playwright/Tauri testing).
- CI должен гонять `niri validate` на тестовых конфигах (если niri доступен в runner).

---

## Performance

- Load большого конфига (< 300–500 ms).
- Save + validate (< 1 s).
- UI не блокируется.

---

## Release checklist 1.0

- [ ] Все фазы 0–3 закрыты.
- [ ] CHANGELOG заполнен.
- [ ] Версия в Cargo.toml / package.json / tauri.conf синхронизирована.
- [ ] PKGBUILD и AppImage собираются в CI.
- [ ] Документация актуальна.
- [ ] Проверено на реальном CachyOS + Niri + Noctalia.
- [ ] Нет известных safety-регрессий.
- [ ] LICENSE и README финальные.

---

## Post-1.0

См. ROADMAP.md (темы, import/export, migration helpers и т.д.).
