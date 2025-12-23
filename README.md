<pre>
                                                                                       ___________
                                                                                      '._==_==_=_.' 
          ██╗████████╗    ██████╗ ███╗   ██╗███████╗     ██████╗██╗   ██╗██████╗     .-\:        /-.
          ██║╚══██╔══╝   ██╔═══██╗████╗  ██║██╔════╝    ██╔════╝██║   ██║██╔══██╗   | (|:.  2    |) | 
          ██║   ██║      ██║   ██║██╔██╗ ██║█████╗      ██║     ██║   ██║██████╔╝    '-|:.       |-'
          ██║   ██║      ██║   ██║██║╚██╗██║██╔══╝      ██║     ██║   ██║██╔═══╝       \::.      /
          ██║   ██║      ╚██████╔╝██║ ╚████║███████╗    ╚██████╗╚██████╔╝██║            '::.    .'
          ╚═╝   ╚═╝       ╚═════╝ ╚═╝  ╚═══╝╚══════╝     ╚═════╝ ╚═════╝ ╚═╝               )  (
                                     [ Code & Analyst · 2025 ]                          _.'    '._
                                                                                      `"""""""""""""`
</pre>
<p align="center">
  <a href="README.md">
    <img src="https://img.shields.io/badge/EN-F2C94C?style=for-the-badge&logo=googletranslate&logoColor=000000">
  </a>
  <a href="README.ru.md">
    <img src="https://img.shields.io/badge/RU-C0392B?style=for-the-badge&logo=googletranslate&logoColor=FFFFFF">
  </a>
</p>

# Suspicious Transaction Detection Platform

A service for automated transaction analysis, detection of suspicious activities,
and real-time management of fraud detection rules.

The project is focused on reducing operational risks,
increasing processing speed, and improving observability of transaction flows.


## Problem Statement

Banking and payment systems process **thousands of transactions daily**,
some of which may be fraudulent.

Key challenges include:
- hardcoded transaction validation logic
- lack of a clear administrative interface
- difficulty in adding and modifying detection rules
- reliance on manual review and human factors

These issues lead to reduced reliability and increased operational costs.


## Solution

A unified platform with a **modular architecture** that enables:

- flexible configuration of fraud detection rules
- rule management via an administrative panel
- real-time transaction analysis
- full transaction and event logging
- real-time notifications for suspicious activities


## Architecture

The platform follows a **microservice-based architecture**
and is deployed using `docker-compose`.

### Core Components:

- **Frontend (Admin Panel)**  
  Rule management, transaction review, and analytics  
  <div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:6px;">
    <img src="https://img.shields.io/badge/HTML5-E34F26?style=for-the-badge&logo=html5&logoColor=white">
    <img src="https://img.shields.io/badge/CSS3-1572B6?style=for-the-badge&logo=css3&logoColor=white">
  </div>

- **Backend API**  
  Request processing, rule execution, and data handling  
  <div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:6px;">
    <img src="https://img.shields.io/badge/Python-3776AB?style=for-the-badge&logo=python&logoColor=white">
    <img src="https://img.shields.io/badge/Django-092E20?style=for-the-badge&logo=django&logoColor=white">
  </div>

- **Stream Processing**  
  Real-time transaction stream handling  
  <div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:6px;">
    <img src="https://img.shields.io/badge/Redis%20Streams-DC382D?style=for-the-badge&logo=redis&logoColor=white">
  </div>

- **Data Storage**  
  Persistent and in-memory data storage  
  <div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:6px;">
    <img src="https://img.shields.io/badge/PostgreSQL-316192?style=for-the-badge&logo=postgresql&logoColor=white">
    <img src="https://img.shields.io/badge/Redis-DC382D?style=for-the-badge&logo=redis&logoColor=white">
  </div>

- **Observability & Logging**  
  <div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:6px;">
    <img src="https://img.shields.io/badge/Prometheus-E6522C?style=for-the-badge&logo=prometheus&logoColor=white">
    <img src="https://img.shields.io/badge/Grafana-F46800?style=for-the-badge&logo=grafana&logoColor=white">
    <img src="https://img.shields.io/badge/Logstash-005571?style=for-the-badge&logo=elastic&logoColor=white">
    <img src="https://img.shields.io/badge/Elasticsearch-005571?style=for-the-badge&logo=elastic&logoColor=white">
    <img src="https://img.shields.io/badge/Kibana-005571?style=for-the-badge&logo=kibana&logoColor=white">
  </div>

- **Notifications**  
  Real-time alerts for suspicious transactions  
  <div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:6px;">
    <img src="https://img.shields.io/badge/Telegram%20Bot-26A5E4?style=for-the-badge&logo=telegram&logoColor=white">
  </div>


## Deployment & Automation

The project is fully automated and can be launched locally:

```bash
git clone <repository-url>
cd <project-directory>
docker-compose up -d --build
```

## Performance

Based on testing results, the platform demonstrates the following metrics:

- **Average processing speed:**  
  ~ 2–3 thousand transactions per second

- **Throughput:**  
  ~ 120–180 thousand transactions per minute

- **Rule execution time:**  
  1 to 5 ms


## Economic Impact

| Metric | Before | After | Impact |
|------|--------|-------|--------|
| Processing time | 50–100 ms | 1–5 ms | Reduced |
| Manual review errors | 15–20% | 2–5% | Reduced |
| Fraud detection rate | 70–80% | 95–98% | Increased |
| Operational costs | 100% | ~35% | Reduced |

The primary benefits are achieved through **automation of transaction analysis**
and **minimization of human involvement**.


## Observability

The platform provides a full observability lifecycle, including:

- transaction statistics collection
- analytics via the administrative panel
- event and operation logging
- transaction and rule management
- metrics and logs visualization


## Rule Management

The following capabilities are implemented:

- creation and modification of detection rules
- rule testing with result output
- enabling and disabling rules
- detailed inspection of rule conditions
- analysis of rule execution results


## Security

The project implements basic security practices:

- usage of `.gitignore` to exclude sensitive and temporary files
- environment-based configuration via `.env`
- secrets removed from `docker-compose.yml`
- service isolation within a Docker network
