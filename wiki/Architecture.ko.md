# 아키텍처

[English](Architecture) · [日本語](Architecture.ja) · [简体中文](Architecture.zh-CN) · [繁體中文](Architecture.zh-TW) · [한국어](Architecture.ko)

> 이 페이지는 [영어 원문](Architecture)을 기계 번역한 문서입니다.

Tako는 Chrome 150 이상에서 동작하는 WXT 기반 Manifest V3 확장 프로그램입니다. 이 페이지는 기여자가 필요한 코드를 찾도록 안내합니다. 다운로드 도움말은 [빠른 시작](Quick-Start.ko)과 [문제 해결](Troubleshooting.ko)을 참고하세요.

## 확장 프로그램 구성

| 구성 요소              | 역할                                                                |
| ---------------------- | ------------------------------------------------------------------- |
| 사이드 패널과 옵션     | 챕터 선택, 다운로드 진행 상황, 기록, 설정                           |
| 백그라운드 서비스 워커 | 대기열, 저장된 상태, 권한, Chrome 다운로드 관리                     |
| 오프스크린 문서        | 챕터 이미지 가져오기 및 처리, 압축 파일 생성, 사용자 지정 폴더 저장 |
| 사이트 연동            | 사이트 인식, 작품 정보, 챕터 목록, 이미지 처리                      |

## 소스 안내

| 작업 대상           | 시작 위치                                                                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 사이드 패널과 옵션  | [`entrypoints/sidepanel/`](https://github.com/oovz/Tako/tree/main/entrypoints/sidepanel), [`entrypoints/options/`](https://github.com/oovz/Tako/tree/main/entrypoints/options) |
| 백그라운드 작업     | [`entrypoints/background/`](https://github.com/oovz/Tako/tree/main/entrypoints/background)                                                                                     |
| 이미지 처리 및 압축 | [`entrypoints/offscreen/`](https://github.com/oovz/Tako/tree/main/entrypoints/offscreen)                                                                                       |
| 사이트 지원         | [`src/site-integrations/`](https://github.com/oovz/Tako/tree/main/src/site-integrations)                                                                                       |
| 도메인 로직         | [`src/domain/`](https://github.com/oovz/Tako/tree/main/src/domain)                                                                                                             |
| 설정 및 기록 저장   | [`src/storage/`](https://github.com/oovz/Tako/tree/main/src/storage)                                                                                                           |
| 공통 런타임 서비스  | [`src/runtime/`](https://github.com/oovz/Tako/tree/main/src/runtime)                                                                                                           |
| 연동 인터페이스     | [`src/types/site-integrations.ts`](https://github.com/oovz/Tako/blob/main/src/types/site-integrations.ts)                                                                      |

개발 환경 설정과 테스트는 [기여 가이드](https://github.com/oovz/Tako/blob/main/CONTRIBUTING.md)를, 사이트 추가는 [사이트 연동 가이드](Site-Integration-Guide.ko)를 참고하세요.

## 참고 자료

- [Chrome 확장 프로그램 Manifest V3](https://developer.chrome.com/docs/extensions/mv3/intro/)
- [Chrome 사이드 패널 API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)
- [Chrome 오프스크린 API](https://developer.chrome.com/docs/extensions/reference/api/offscreen)
- [Chrome 다운로드 API](https://developer.chrome.com/docs/extensions/reference/api/downloads)
