# War Chest Solo Local — v0.2

War Chest 기본판의 핵심 규칙을 바탕으로 만든 **비공식 개인용 로컬 1인 웹게임**입니다. 원작 카드 이미지나 아트 자산은 포함하지 않고, 텍스트와 자체 도형 UI만 사용합니다.

## 이번 버전의 주요 기능

- Human vs 로컬 규칙 기반 Bot
- 기본판 16종 유닛 및 주요 특수 능력 구현
- Bot 난이도 `Easy / Normal / Hard`
  - Easy: 상위 후보 중 확률적으로 선택해 전술 실수가 나올 수 있음
  - Normal: 즉시 행동 휴리스틱 최고점 선택
  - Hard: 행동을 복제 상태에 실제 적용한 뒤 보드 가치 변화까지 추가 평가
- **Bot Explain**: 방금 둔 수의 이유와 상위 후보 3개 표시
- **Undo**: 직전 인간 주 행동 직전으로 복구. 이후 봇 응수도 함께 취소
- **Position Analysis**: 거점, 보드 전력, 제거 코인, 점령 압박 간이 비교
- **8-unit Snake Draft**: `1–2–2–2–1` 방식. 사용자가 첫 드래프터, Bot이 두 번째 드래프터
- 자동 로컬 저장 / 이어하기
- 원작 아트 없이 자체 보드/코인 스타일 UI

## 실행

빌드 결과물(`dist/`)이 포함되어 있으므로 Node 패키지를 설치하지 않아도 실행할 수 있습니다.

```bash
cd war-chest-solo
python3 -m http.server 4173
```

브라우저에서 아래 주소를 엽니다.

```text
http://localhost:4173
```

## 소스 수정 후 빌드

```bash
npm install
npm run build
```

## 테스트

```bash
npm test
node test/simulate.mjs
```

`npm test`는 룰 판정과 3단계 Bot decision 생성 테스트를 수행합니다. `simulate.mjs`는 무작위 군대로 Bot vs Bot 게임을 반복해 코인 보존 및 상태 이상을 확인합니다.

## 구현된 기본 행동

- Deploy
- Bolster
- Move
- Attack
- Control
- Recruit
- Claim Initiative
- Pass
- Tactic

## 구현된 유닛

Archer, Berserker, Cavalry, Crossbowman, Ensign, Footman, Knight, Lancer, Light Cavalry, Marshall, Mercenary, Pikeman, Royal Guard(개정 능력), Scout, Swordsman, Warrior Priest.

### 판정상 중요한 부분

- Archer의 2칸 전술 공격은 중간 칸에 유닛이 있어도 가능합니다.
- Crossbowman의 2칸 전술 공격은 직선이며 중간 칸이 비어 있어야 합니다.
- Knight는 강화된 공격자에게만 Attack을 받을 수 있습니다.
- Pikeman의 반격은 Attack 자체가 아닌 별도 코인 제거로 처리됩니다.
- Footman은 동일 유닛을 둘까지 배치할 수 있습니다.
- Warrior Priest 추가 코인은 즉시 사용합니다.
- 공격으로 제거된 코인은 Supply/Discard가 아니라 게임에서 제거됩니다.

## Undo 동작

Undo snapshot은 사용자가 **손의 코인을 처음 소비하는 주 행동**을 시작하기 직전에 저장됩니다. Swordsman 후속 이동, Berserker 연속 기동, Warrior Priest 추가 코인처럼 같은 행동에서 이어지는 후속 처리와 그 뒤의 Bot 응수는 한 묶음으로 되돌아갑니다.

새로고침을 넘겨 Undo history까지 영구 저장하지는 않습니다. 게임 상태 자체는 자동 저장됩니다.

## Draft

설정 화면에서 `8유닛 드래프트`를 선택합니다. 무작위 8종을 공개하고 다음 순서로 나눠 갖습니다.

```text
Human 1 → Bot 2 → Human 2 → Bot 2 → Human 1
```

현재 구현에서는 Human이 첫 드래프터이므로 두 번째 드래프터인 Bot이 게임 시작 Initiative를 갖습니다.

## 주의

- 개인 학습/프로토타입 목적의 비공식 구현입니다.
- 규칙 텍스트를 이해하기 쉽게 재서술했으며 원작의 그래픽 자산은 배포하지 않습니다.
- Bot은 탐색형 게임 AI가 아니라 로컬에서 즉시 동작하도록 만든 heuristic AI입니다. Hard도 완전 탐색이나 승률 계산은 하지 않습니다.
