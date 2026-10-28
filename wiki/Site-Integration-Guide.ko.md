# 사이트 연동 기여 가이드

[English](Site-Integration-Guide) · [日本語](Site-Integration-Guide.ja) · [简体中文](Site-Integration-Guide.zh-CN) · [繁體中文](Site-Integration-Guide.zh-TW) · [한국어](Site-Integration-Guide.ko)

> 이 페이지는 [영어 원문](Site-Integration-Guide)을 기계 번역한 문서입니다.

이 가이드는 지원 사이트를 추가하거나 유지하는 기여자를 위한 문서입니다. 코드를 작성하지 않고 사이트 지원을 요청하려면 [기능 요청](https://github.com/oovz/Tako/issues/new?template=feature_request.md)을 등록하세요.

설정 방법은 [기여 가이드](https://github.com/oovz/Tako/blob/main/CONTRIBUTING.md), 런타임의 역할 분담은 [아키텍처](Architecture.ko)를 참고하세요. 연동은 확장 프로그램에 포함되는 TypeScript 모듈입니다.

## 연동의 역할

사이트 연동은 지원하는 페이지를 식별하고, 작품과 챕터 정보를 확인하고, 이미지를 다운로드하며, 사이트별 이미지 변환을 처리합니다. 연동 정의에는 출처, 요청 정책, 설정을 선언합니다.

## 사이트 추가

### 1. 기본 구조 생성

```powershell
pnpm new:site-integration <id> --name "Native Site Name" --english-name "English Site Name"
```

이 명령은 소스 파일과 테스트 데이터의 초기 구조를 만듭니다.

| 파일                                                  | 용도                                        |
| ----------------------------------------------------- | ------------------------------------------- |
| `src/site-integrations/<id>/definition.json`          | 식별 정보, URL 매칭, 출처, 기능, 정책, 설정 |
| `src/site-integrations/<id>/background-runtime.ts`    | 작품과 챕터 목록 확인                       |
| `src/site-integrations/<id>/offscreen-runtime.ts`     | 챕터 계획과 이미지 다운로드                 |
| `src/site-integrations/<id>/contracts/index.ts`       | 사이트 데이터 계약                          |
| `tests/fixtures/site-integrations/<id>/contract.json` | 결정적 테스트 데이터의 초기 구조            |

기본 구조는 `shipped: false`, `enabledByDefault: false`로 시작합니다. 구현과 테스트가 릴리스할 준비를 마치면 `shipped: true`로 설정하세요. 별도 위치에 생성할 때는 `--out-dir`로 소스 대상 경로를, `--fixtures-dir`로 테스트 데이터 대상 경로를 지정할 수 있습니다.

### 2. 사이트 계약 선언

[정의 스키마](https://github.com/oovz/Tako/blob/main/src/site-integrations/definition.schema.json)와 비슷한 기존 연동을 참고해 `definition.json`을 편집하세요.

`name`에는 사이트의 원어 표시 이름을, `englishName`에는 영어 이름을 설정하세요. `id`와 연동 디렉터리에는 안정적인 식별자를 사용하고 대체 도메인은 매칭 규칙에 넣으세요.

Tako가 인식할 페이지, 고정 및 선택적 출처, 엔드포인트 용도, 인증 정보, 응답 유형과 제한, 요청 간격, 재시도 담당 계층, 필요한 런타임 기능을 정의하세요. 연동에 필요한 접근 권한만 선언하세요.

### 3. 백그라운드에서 작품 정보 확인

[`ServiceWorkerIntegration`](https://github.com/oovz/Tako/blob/main/src/types/site-integrations.ts)에 따라 `background-runtime.ts`에 `series.resolveSeriesData`를 구현하세요.

URL 데이터, 사이트 API 또는 가져온 HTML에서 작품 제목, 메타데이터, 챕터 ID, 챕터 URL, 이용 가능 여부를 확인하세요. 요청에는 `integrationHttpClient`를 사용하고 반환하기 전에 사이트 데이터를 검증하세요. 챕터 처리에 필요할 때만 디스패치 컨텍스트 준비 기능을 추가하세요.

### 4. 오프스크린에서 챕터 이미지 확인 및 다운로드

[`OffscreenIntegration`](https://github.com/oovz/Tako/blob/main/src/types/site-integrations.ts)에 따라 `offscreen-runtime.ts`에 `chapter.resolveChapterPlan`과 `chapter.downloadImage`를 구현하세요.

공통 챕터 계획 스키마와 `fetchImageWithStallDetection`을 사용하세요. 취소 신호, 속도 설정, 바이트 진행 상황, 리소스 관리 정보를 전달하고 인터페이스에 정의된 이미지 결과를 반환하세요. 각 요청은 한 번만 스케줄링하세요.

메모리를 할당하거나 권한이 필요한 작업을 하기 전에 응답 크기, 이미지 치수, 페이지 수, 사이트가 제공한 URL을 검증하세요. 변환에 필요한 리소스를 예약하고 성공, 실패, 취소 시 해제해야 합니다.

### 5. 연동 문서화 및 테스트

저장한 HTML, 프로토콜 테스트 벡터, 제어된 이미지 입력은 `tests/fixtures/site-integrations/<id>/`에 두세요. 생성기는 표준 `contract.json`의 `schemaVersion: 1`, 연동의 `providerId`, 객체 형태의 `data`를 확인합니다. 캡처한 필드와 합성 테스트 데이터를 구별할 수 있도록 데이터 옆에 출처 설명을 두세요.

관련 동작을 검증하는 단위 테스트를 추가하고, UI에 드러나는 동작은 모의 응답을 사용하는 브라우저 테스트로 확인하세요. 정상 디코딩과 함께 페이지 순서 및 변환한 이미지 내용도 확인하세요.

사용자 안내는 [지원 사이트](Supported-Sites.ko)와 [문제 해결](Troubleshooting.ko)에서 갱신하세요. 실제 사이트 검사는 `tests/live/`에 두고, 공통 작품 URL은 `tests/e2e/fixtures/test-domains-constants.ts`에 정의하세요.

### 6. 생성 및 검증

개발 중에는 관련 테스트와 다음 검사를 실행하세요.

```powershell
pnpm generate:site-integrations
pnpm check:site-integrations
pnpm type-check
pnpm lint
pnpm test:unit
```

리졸버와 픽스처가 준비되면 `shipped: true`로 설정하고 카탈로그를 다시 생성하세요. [기여 가이드](https://github.com/oovz/Tako/blob/main/CONTRIBUTING.md#testing)의 해당 통합 및 브라우저 검사를 실행한 뒤 `pnpm build`로 프로덕션 확장 프로그램을 빌드하세요.

사이트에 접근할 수 있으면 [실제 챕터 검사](https://github.com/oovz/Tako/blob/main/CONTRIBUTING.md#live-chapter-validation)를 실행하고 변환한 페이지를 사이트 리더와 비교하세요.

## 선택적 기능

### 일회성 페이지 프로브

실제 페이지 상태가 필요하면 `pageProbe: "optional"` 또는 `"required"`를 선언하고 `probe.ts`를 제공하세요. 범위가 제한된 읽기 전용 프로브로 검증된 일반 데이터를 반환하고 작업이 끝나면 리소스를 해제하세요. 기본적으로 격리된 월드를 사용하세요.

### 요청 헤더

필요한 Referer 규칙을 `sessionRefererRules`에 선언하세요. 관리 ID 범위 `41000`–`41999`와 선언된 사이트 도메인 및 출처를 사용하세요. 규칙은 확장 프로그램 요청에만 적용됩니다.

### 이미지 변환

정의 파일에 이미지 변환을 선언하고 오프스크린 런타임에 구현하세요. 컷, 타일, 페이지 순서를 테스트하세요. 표지에 다른 이미지 처리가 필요하면 `cover.downloadImage`를 구현하세요.

### 사이트가 제공하는 이미지 서버

이미지 호스트를 동적으로 선택하는 경우 `originKind: "provider-issued"`를 선언하고 사이트가 URL을 제공하는 지점에서 검증하세요. 고정 엔드포인트 출처는 `requiredOrigins`에, 선택적 호스트 패턴은 `optionalOrigins`에 넣으세요.

### 번역된 설정

`customSettings`에 타입이 있는 설정을 선언하세요. 레이블, 설명, 선택 항목 레이블은 다섯 로케일 카탈로그 `en`, `ja`, `zh_CN`, `zh_TW`, `ko`에 모두 있어야 합니다. 생성기가 필요한 키의 존재 여부를 확인합니다.

## 공통 요청 보안

요청에는 `integrationHttpClient`와 공통 이미지 전송을 사용하세요. 필요한 출처, 인증 정보 정책, 응답 크기 제한을 정의 파일에 선언하세요. 실행 가능한 코드는 확장 프로그램에 포함하고 원격 응답은 데이터로 파싱하세요. 인증 정보와 원본 응답을 로그에 기록하지 마세요.

관련 문서: [아키텍처](Architecture.ko), [권한](Permissions.ko), [지원 사이트](Supported-Sites.ko).
