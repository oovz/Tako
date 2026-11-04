# 사이트 통합 추가하기

[English](Site-Integration-Guide) · [日本語](Site-Integration-Guide.ja) · [简体中文](Site-Integration-Guide.zh-CN) · [繁體中文](Site-Integration-Guide.zh-TW) · [한국어](Site-Integration-Guide.ko)

코드를 작성하지 않고 사이트 지원을 요청하려면 [기능 요청](https://github.com/oovz/Tako/issues/new?template=feature_request.md)을 등록하세요. 개발 환경 설정은 [기여 가이드(영문)](https://github.com/oovz/Tako/blob/main/CONTRIBUTING.md)를 참고하세요.

## 통합 만들기

```sh
pnpm new:site-integration <id> --name "Native Site Name" --english-name "English Site Name"
```

`--name`에는 사이트의 현지 언어 이름을 입력하세요. 영어 사이트는 `--english-name`에도 같은 이름을 입력하세요. 그 외 사이트는 운영자가 공식 웹사이트, 로고, 공식 소셜 미디어 계정에서 사용하는 영어 이름이나 로마자 브랜드명을 입력하세요. 둘 다 없으면 기본 도메인의 공개 접미사 바로 앞 부분을 사용하세요. 예를 들어 `www.example.co.jp`는 `example`을 사용하세요.

이 명령은 `src/site-integrations/<id>/`에 소스 파일을, `tests/fixtures/site-integrations/<id>/`에 테스트 데이터를 만듭니다.

`definition.json`에 지원 URL과 필요한 접근 권한을 선언하세요. 작품 정보와 챕터 목록은 `background-runtime.ts`에서, 챕터 이미지는 `offscreen-runtime.ts`에서 불러오도록 구현하세요. [정의 스키마](https://github.com/oovz/Tako/blob/main/src/site-integrations/definition.schema.json), [런타임 인터페이스](https://github.com/oovz/Tako/blob/main/src/types/site-integrations.ts), 비슷한 기존 통합을 참고하세요.

요청을 보낼 때는 `integrationHttpClient`를, 이미지를 가져올 때는 `fetchImageWithStallDetection`을 사용하세요. 취소 신호, 속도 설정, 바이트 단위 진행 상황, 리소스 사용량 관리에 필요한 인자를 전달하세요. 각 요청은 한 번만 스케줄링하세요.

리소스를 할당하거나 권한이 필요한 작업을 수행하기 전에 응답 크기, 이미지의 가로·세로 크기, 페이지 수, 사이트에서 제공한 URL을 검증하세요. 이미지 변환에 필요한 리소스를 예약하고 성공, 실패, 취소 시 모두 해제하세요.

필요한 사이트 접근 권한만 요청하세요. 실행 코드는 확장 프로그램에 포함해야 합니다. 사이트 응답의 코드를 실행하거나 인증 정보를 로그에 남기지 마세요.

## 테스트 추가하기

생성된 `contract.json` 옆에 HTML, API, 이미지 테스트 데이터를 보관하세요. 출처를 기록하고 계정 정보, 쿠키, 토큰을 제거하세요.

생성기는 `contract.json`의 형식을 검사합니다. `schemaVersion: 1`, 통합에 해당하는 `providerId`, 객체형 `data`가 필요합니다.

메타데이터, 챕터 순서, 이미지 변환, 실패 처리를 테스트하세요. 화면 동작은 모의 브라우저 테스트로 확인하고, 압축 파일의 존재뿐 아니라 저장된 이미지도 검사하세요. 실제 사이트에 접근할 수 있으면 라이브 테스트를 추가하세요.

```sh
pnpm generate:site-integrations
pnpm lint
pnpm type-check
pnpm test:unit
```

[기여 가이드의 테스트 안내](https://github.com/oovz/Tako/blob/main/CONTRIBUTING.md#testing)에 따라 관련 통합 및 브라우저 테스트를 실행한 뒤 `pnpm build`를 실행하세요.

## 기여 마무리하기

생성된 통합의 초기 설정은 `shipped: false`, `enabledByDefault: false`입니다. 구현과 테스트가 준비되면 `shipped: true`로 바꾸고 카탈로그를 다시 생성하세요.

타입이 지정된 설정을 `customSettings`에 선언하세요. 참조하는 설정 이름, 설명, 선택 항목 이름을 `en`, `ja`, `zh_CN`, `zh_TW`, `ko`의 다섯 언어 카탈로그 모두에 추가하세요.

[지원 사이트](Supported-Sites.ko)와 [문제 해결](Troubleshooting.ko)을 업데이트하고, 다운로드에 영향을 주는 접근 조건을 설명하세요.

## 선택 기능

### 일회성 페이지 프로브

현재 페이지 상태가 필요하면 `pageProbe: "optional"` 또는 `"required"`를 선언하고 `probe.ts`를 제공하세요. 범위가 제한된 읽기 전용 프로브를 사용해 검증된 일반 데이터를 반환하고, 작업이 끝나면 리소스를 해제하세요. 기본적으로 격리된 실행 환경을 사용하세요.

### 요청 헤더

필요한 Referer 규칙을 `sessionRefererRules`에 선언하세요. 관리 대상 ID 범위 `41000`–`41999`와 선언된 사이트 도메인 및 출처를 사용하세요. 규칙은 확장 프로그램 요청에만 적용하세요.

### 이미지 변환

정의 파일에 이미지 변환을 선언하고 오프스크린에서 구현하세요. 패널, 타일, 페이지 순서를 테스트하세요. 표지에 다른 이미지 처리가 필요하면 `cover.downloadImage`를 제공하세요.

### 사이트에서 제공하는 이미지 서버

이미지 호스트가 동적으로 선택되면 `originKind: "provider-issued"`를 선언하고 사이트에서 URL을 제공하는 지점에서 검증하세요. 고정된 엔드포인트의 출처는 `requiredOrigins`에, 선택적 호스트 패턴은 `optionalOrigins`에 넣으세요.
