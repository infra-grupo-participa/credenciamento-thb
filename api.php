<?php
/**
 * Backend de credenciamento — CHF 2026 Goiânia
 *
 * COMO USAR:
 * 1. Altere a senha abaixo (AUTH_TOKEN) para algo só seu.
 * 2. Suba este arquivo (api.php) + index.html para a mesma pasta na Hostinger (public_html).
 * 3. Ao abrir o site, será pedida a senha uma vez por navegador — use a mesma senha aqui configurada.
 * 4. O arquivo data.json será criado automaticamente na mesma pasta.
 *
 * Recomendado: criar backup diário exportando via o botão "Exportar" no app.
 */

define('AUTH_TOKEN', 'Clinica@102030@THB');
define('DATA_FILE', __DIR__ . '/data.json');

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-Auth-Token');
header('Cache-Control: no-store, no-cache, must-revalidate');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    if (!file_exists(DATA_FILE)) {
        echo json_encode(['list' => [], 'updatedAt' => null], JSON_UNESCAPED_UNICODE);
        exit;
    }
    $content = file_get_contents(DATA_FILE);
    echo $content !== false ? $content : json_encode(['list' => [], 'updatedAt' => null]);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $token = isset($_SERVER['HTTP_X_AUTH_TOKEN']) ? $_SERVER['HTTP_X_AUTH_TOKEN'] : '';
    if (!hash_equals(AUTH_TOKEN, $token)) {
        http_response_code(401);
        echo json_encode(['error' => 'unauthorized']);
        exit;
    }

    $body = file_get_contents('php://input');
    $data = json_decode($body, true);
    if (!is_array($data) || !isset($data['list']) || !is_array($data['list'])) {
        http_response_code(400);
        echo json_encode(['error' => 'invalid_payload']);
        exit;
    }

    $payload = [
        'list' => $data['list'],
        'updatedAt' => date('c')
    ];

    $encoded = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    if ($encoded === false) {
        http_response_code(500);
        echo json_encode(['error' => 'encode_failed']);
        exit;
    }

    // Escrita atômica com lock para evitar corrupção em gravações simultâneas
    $fp = fopen(DATA_FILE, 'c+');
    if (!$fp) {
        http_response_code(500);
        echo json_encode(['error' => 'open_failed']);
        exit;
    }
    if (flock($fp, LOCK_EX)) {
        ftruncate($fp, 0);
        rewind($fp);
        fwrite($fp, $encoded);
        fflush($fp);
        flock($fp, LOCK_UN);
    }
    fclose($fp);
    @chmod(DATA_FILE, 0644);

    echo json_encode(['ok' => true, 'updatedAt' => $payload['updatedAt'], 'count' => count($data['list'])]);
    exit;
}

http_response_code(405);
echo json_encode(['error' => 'method_not_allowed']);
