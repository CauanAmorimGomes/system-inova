<?php
/**
 * api.php — REST API para Inova+ Helpdesk
 * absprinter © 2025
 *
 * Rotas disponíveis:
 *   GET    /api.php?resource=tickets          → lista todos os tickets
 *   GET    /api.php?resource=tickets&id=#0042 → busca um ticket
 *   POST   /api.php?resource=tickets          → cria novo ticket
 *   PUT    /api.php?resource=tickets&id=#0042 → atualiza ticket
 *   DELETE /api.php?resource=tickets&id=#0042 → remove ticket
 *
 *   GET    /api.php?resource=team             → lista equipe
 *   GET    /api.php?resource=kb               → lista base de conhecimento
 *   POST   /api.php?resource=tickets&action=reply&id=#0042 → adiciona comentário
 *
 *   GET    /api.php?resource=notifications    → últimas notificações (sininho)
 *   GET    /api.php?resource=notifications&since=2025-01-01T00:00:00Z
 */

require_once 'db.php';

// ── CORS & Headers ──────────────────────────────────────────────────────────
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With');

// Preflight OPTIONS
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// ── Roteador ────────────────────────────────────────────────────────────────
$method   = $_SERVER['REQUEST_METHOD'];
$resource = $_GET['resource'] ?? '';
$id       = $_GET['id']       ?? null;
$action   = $_GET['action']   ?? null;

// Lê body JSON para POST/PUT
$body = [];
if (in_array($method, ['POST', 'PUT'])) {
    $raw = file_get_contents('php://input');
    $body = json_decode($raw, true) ?? [];
    // fallback para form-data
    if (empty($body) && !empty($_POST)) {
        $body = $_POST;
    }
}

try {
    switch ($resource) {
        case 'tickets':
            handleTickets($method, $id, $action, $body);
            break;
        case 'team':
            handleTeam($method, $id, $body);
            break;
        case 'kb':
            handleKB($method, $id, $body);
            break;
        case 'notifications':
            handleNotifications($method);
            break;
        default:
            jsonResponse(404, ['error' => "Recurso '$resource' não encontrado."]);
    }
} catch (Exception $e) {
    jsonResponse(500, ['error' => $e->getMessage()]);
}

// ── TICKETS ──────────────────────────────────────────────────────────────────
function handleTickets(string $method, ?string $id, ?string $action, array $body): void
{
    $db = new DB('tickets');

    // POST /api.php?resource=tickets&action=reply&id=#0042
    if ($method === 'POST' && $action === 'reply' && $id) {
        $ticket = $db->find($id);
        if (!$ticket) {
            jsonResponse(404, ['error' => "Ticket $id não encontrado."]);
        }
        $comment = [
            'author'   => sanitize($body['author'] ?? 'Anônimo'),
            'text'     => sanitize($body['text']   ?? ''),
            'time'     => date('H\hi'),
            'at'       => date('c'),
            'internal' => !empty($body['internal']),
        ];
        if (empty($comment['text'])) {
            jsonResponse(400, ['error' => 'O campo "text" é obrigatório.']);
        }
        $ticket['comments'][]  = $comment;
        $ticket['updated_at']  = date('c');
        $db->update($id, $ticket);
        addNotification('comment', $ticket,
            "Novo comentário em {$ticket['id']}",
            "{$comment['author']}: " . mb_strimwidth($comment['text'], 0, 90, '…'),
            $comment['author']);
        jsonResponse(201, ['message' => 'Comentário adicionado.', 'comment' => $comment]);
        return;
    }

    switch ($method) {

        // ── GET ───────────────────────────────────────────────────────────
        case 'GET':
            if ($id) {
                $ticket = $db->find($id);
                if (!$ticket) jsonResponse(404, ['error' => "Ticket $id não encontrado."]);
                jsonResponse(200, $ticket);
            } else {
                $tickets = $db->all();

                // Filtros via query string
                if (!empty($_GET['status']))   $tickets = array_filter($tickets, fn($t) => $t['status']   === $_GET['status']);
                if (!empty($_GET['priority'])) $tickets = array_filter($tickets, fn($t) => $t['priority'] === $_GET['priority']);
                if (!empty($_GET['category'])) $tickets = array_filter($tickets, fn($t) => $t['category'] === $_GET['category']);
                if (!empty($_GET['search'])) {
                    $q = strtolower($_GET['search']);
                    $tickets = array_filter($tickets, fn($t) =>
                        str_contains(strtolower($t['subject'] ?? ''), $q) ||
                        str_contains(strtolower($t['id']      ?? ''), $q) ||
                        str_contains(strtolower($t['requester'] ?? ''), $q)
                    );
                }

                jsonResponse(200, array_values($tickets));
            }
            break;

        // ── POST ──────────────────────────────────────────────────────────
        case 'POST':
            $required = ['subject' => 'Assunto', 'category' => 'Categoria', 'desc' => 'Descrição'];
            foreach ($required as $field => $label) {
                if (trim((string)($body[$field] ?? '')) === '') {
                    jsonResponse(400, ['error' => "Campo obrigatório ausente: $label"]);
                }
            }
            if (mb_strlen(trim((string)$body['subject'])) < 5) {
                jsonResponse(400, ['error' => 'O assunto deve ter pelo menos 5 caracteres.']);
            }
            if (mb_strlen(trim((string)$body['desc'])) < 10) {
                jsonResponse(400, ['error' => 'A descrição deve ter pelo menos 10 caracteres.']);
            }

            $validPriorities = ['Crítica', 'Alta', 'Média', 'Baixa'];
            $priority = in_array($body['priority'] ?? '', $validPriorities, true) ? $body['priority'] : 'Média';

            $all   = $db->all();
            $maxId = 0;
            foreach ($all as $t) {
                $num = (int) ltrim($t['id'], '#');
                if ($num > $maxId) $maxId = $num;
            }
            $newId = '#' . str_pad((string)($maxId + 1), 4, '0', STR_PAD_LEFT);

            // Anexos (multipart/form-data → attachments[])
            $attachments = saveAttachments($_FILES['attachments'] ?? null, ltrim($newId, '#'));

            $ticket = [
                'id'          => $newId,
                'subject'     => sanitize(trim((string)$body['subject'])),
                'category'    => sanitize($body['category']),
                'requester'   => sanitize($body['requester'] ?? 'Usuário'),
                'assignee'    => sanitize($body['assignee']  ?? 'Ana Lima'),
                'priority'    => $priority,
                'status'      => 'Aberto',
                'sla'         => 100,
                'created'     => date('Y-m-d'),
                'created_at'  => date('c'),
                'updated_at'  => date('c'),
                'serial'      => sanitize($body['serial']   ?? ''),
                'model'       => sanitize($body['model']    ?? ''),
                'dept'        => sanitize($body['dept']     ?? 'TI'),
                'location'    => sanitize($body['location'] ?? ''),
                'contact'     => sanitize($body['contact']  ?? ''),
                'desc'        => sanitize(trim((string)$body['desc'])),
                'attachments' => $attachments,
                'comments'    => [],
            ];

            $db->insert($ticket['id'], $ticket);
            addNotification('new_ticket', $ticket,
                "Novo chamado {$ticket['id']} na fila" . ($ticket['priority'] === 'Crítica' ? ' 🚨' : ''),
                "{$ticket['subject']} · {$ticket['category']} · Prioridade {$ticket['priority']} · Atribuído a {$ticket['assignee']}",
                $ticket['requester']);
            jsonResponse(201, ['message' => 'Ticket criado com sucesso.', 'ticket' => $ticket]);
            break;

        // ── PUT ───────────────────────────────────────────────────────────
        case 'PUT':
            if (!$id) jsonResponse(400, ['error' => 'ID do ticket é obrigatório para atualização.']);

            $ticket = $db->find($id);
            if (!$ticket) jsonResponse(404, ['error' => "Ticket $id não encontrado."]);

            $before = $ticket;
            $actor  = sanitize($body['actor'] ?? 'Sistema');

            // Campos permitidos para atualização
            $allowed = ['subject', 'category', 'assignee', 'priority', 'status', 'sla', 'desc', 'serial', 'model', 'dept', 'location', 'contact'];
            foreach ($allowed as $field) {
                if (array_key_exists($field, $body)) {
                    $ticket[$field] = is_string($body[$field])
                        ? sanitize($body[$field])
                        : $body[$field];
                }
            }

            $ticket['updated_at'] = date('c');
            if (($before['status'] ?? '') !== ($ticket['status'] ?? '') && in_array($ticket['status'], ['Resolvido', 'Fechado'], true)) {
                $ticket['resolved_at'] = $ticket['resolved_at'] ?? date('c');
            }
            $db->update($id, $ticket);
            notifyTicketChange($before, $ticket, $actor);
            jsonResponse(200, ['message' => 'Ticket atualizado.', 'ticket' => $ticket]);
            break;

        // ── DELETE ────────────────────────────────────────────────────────
        case 'DELETE':
            if (!$id) jsonResponse(400, ['error' => 'ID do ticket é obrigatório para exclusão.']);

            $ticket = $db->find($id);
            if (!$ticket) jsonResponse(404, ['error' => "Ticket $id não encontrado."]);

            $db->delete($id);
            jsonResponse(200, ['message' => "Ticket $id removido com sucesso."]);
            break;

        default:
            jsonResponse(405, ['error' => 'Método não permitido.']);
    }
}

// ── TEAM ─────────────────────────────────────────────────────────────────────
function handleTeam(string $method, ?string $id, array $body): void
{
    $db = new DB('team');

    switch ($method) {
        case 'GET':
            jsonResponse(200, array_values($db->all()));
            break;
        case 'PUT':
            if (!$id) jsonResponse(400, ['error' => 'ID obrigatório.']);
            $member = $db->find($id);
            if (!$member) jsonResponse(404, ['error' => "Membro $id não encontrado."]);
            foreach (['role', 'dept', 'online', 'tickets', 'sla'] as $f) {
                if (array_key_exists($f, $body)) $member[$f] = $body[$f];
            }
            $db->update($id, $member);
            jsonResponse(200, ['message' => 'Membro atualizado.', 'member' => $member]);
            break;
        default:
            jsonResponse(405, ['error' => 'Método não permitido para team.']);
    }
}

// ── KNOWLEDGE BASE ────────────────────────────────────────────────────────────
function handleKB(string $method, ?string $id, array $body): void
{
    $db = new DB('kb');

    switch ($method) {
        case 'GET':
            $articles = array_values($db->all());
            if (!empty($_GET['cat']))    $articles = array_values(array_filter($articles, fn($a) => $a['cat'] === $_GET['cat']));
            if (!empty($_GET['search'])) {
                $q = strtolower($_GET['search']);
                $articles = array_values(array_filter($articles, fn($a) =>
                    str_contains(strtolower($a['title'] ?? ''), $q) ||
                    str_contains(strtolower(implode(' ', $a['tags'] ?? [])), $q)
                ));
            }
            jsonResponse(200, $articles);
            break;
        case 'POST':
            if (empty($body['title']) || empty($body['cat'])) {
                jsonResponse(400, ['error' => 'Campos title e cat são obrigatórios.']);
            }
            $all = $db->all();
            $newId = count($all) + 1;
            $article = [
                'id'    => $newId,
                'title' => sanitize($body['title']),
                'cat'   => sanitize($body['cat']),
                'views' => 0,
                'tags'  => $body['tags'] ?? [],
                'body'  => $body['body'] ?? '',
            ];
            $db->insert((string)$newId, $article);
            jsonResponse(201, ['message' => 'Artigo criado.', 'article' => $article]);
            break;
        case 'DELETE':
            if (!$id) jsonResponse(400, ['error' => 'ID obrigatório.']);
            $db->delete($id);
            jsonResponse(200, ['message' => "Artigo $id removido."]);
            break;
        default:
            jsonResponse(405, ['error' => 'Método não permitido para kb.']);
    }
}

// ── NOTIFICAÇÕES ─────────────────────────────────────────────────────────────
function handleNotifications(string $method): void
{
    if ($method !== 'GET') jsonResponse(405, ['error' => 'Método não permitido para notifications.']);

    $db    = new DB('notifications');
    $items = array_values($db->all());

    if (!empty($_GET['since'])) {
        $since = strtotime($_GET['since']);
        $items = array_values(array_filter($items, fn($n) => strtotime($n['created_at']) > $since));
    }
    usort($items, fn($a, $b) => strcmp($b['created_at'], $a['created_at']));
    jsonResponse(200, array_slice($items, 0, 50));
}

function addNotification(string $type, array $ticket, string $title, string $msg, ?string $actor = null): void
{
    $db = new DB('notifications');
    $id = 'n' . date('YmdHis') . bin2hex(random_bytes(3));
    $db->insert($id, [
        'id'         => $id,
        'type'       => $type,
        'ticketId'   => $ticket['id'] ?? null,
        'priority'   => $ticket['priority'] ?? null,
        'title'      => $title,
        'msg'        => $msg,
        'actor'      => $actor,
        'created_at' => date('c'),
    ]);

    // Mantém só as 200 mais recentes
    $all = $db->all();
    if (count($all) > 200) {
        foreach (array_slice(array_keys($all), 200) as $old) $db->delete($old);
    }
}

function notifyTicketChange(array $before, array $after, string $actor): void
{
    $id = $after['id'];
    if (($before['status'] ?? '') !== ($after['status'] ?? '')) {
        [$type, $title] = match ($after['status']) {
            'Em andamento' => ['attend',   "Chamado $id em atendimento"],
            'Resolvido'    => ['resolved', "Chamado $id resolvido ✅"],
            'Fechado'      => ['closed',   "Chamado $id fechado"],
            default        => ['status',   "Chamado $id → {$after['status']}"],
        };
        $msg = $after['status'] === 'Em andamento'
            ? "{$after['assignee']} assumiu \"{$after['subject']}\""
            : "{$after['subject']} · por $actor";
        addNotification($type, $after, $title, $msg, $actor);
    } elseif (($before['assignee'] ?? '') !== ($after['assignee'] ?? '')) {
        addNotification('assign', $after, "Chamado $id reatribuído",
            "Agora com {$after['assignee']} · {$after['subject']}", $actor);
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function jsonResponse(int $status, array $data): never
{
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    exit;
}

function sanitize(mixed $value): string
{
    return htmlspecialchars(strip_tags((string)$value), ENT_QUOTES, 'UTF-8');
}

/**
 * Salva anexos enviados em uploads/{ticket}/ e devolve os metadados.
 * Aceita PNG, JPG e PDF até 10 MB cada (máx. 5 arquivos).
 */
function saveAttachments(?array $files, string $ticketNum): array
{
    if (!$files || empty($files['name'])) return [];

    // Normaliza input único ou múltiplo
    $names = (array) $files['name'];
    $tmps  = (array) $files['tmp_name'];
    $errs  = (array) $files['error'];
    $sizes = (array) $files['size'];

    $maxSize  = 10 * 1024 * 1024;
    $allowed  = ['image/png' => 'png', 'image/jpeg' => 'jpg', 'application/pdf' => 'pdf'];
    $finfo    = new finfo(FILEINFO_MIME_TYPE);
    $dir      = __DIR__ . "/uploads/$ticketNum";
    $saved    = [];

    if (count($names) > 5) {
        jsonResponse(400, ['error' => 'Máximo de 5 anexos por chamado.']);
    }

    foreach ($names as $i => $original) {
        if (($errs[$i] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_NO_FILE) continue;
        if ($errs[$i] !== UPLOAD_ERR_OK) {
            $msg = in_array($errs[$i], [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true)
                ? "O arquivo \"$original\" excede o limite do servidor (verifique upload_max_filesize no php.ini)."
                : "Falha ao enviar \"$original\" (código {$errs[$i]}).";
            jsonResponse(400, ['error' => $msg]);
        }
        if ($sizes[$i] > $maxSize) {
            jsonResponse(400, ['error' => "\"$original\" passa de 10 MB."]);
        }
        $mime = $finfo->file($tmps[$i]) ?: '';
        if (!isset($allowed[$mime])) {
            jsonResponse(400, ['error' => "Tipo de arquivo não permitido: \"$original\". Use PNG, JPG ou PDF."]);
        }

        if (!is_dir($dir)) mkdir($dir, 0755, true);
        $safeName = bin2hex(random_bytes(8)) . '.' . $allowed[$mime];
        if (!move_uploaded_file($tmps[$i], "$dir/$safeName")) {
            jsonResponse(500, ['error' => "Não foi possível salvar \"$original\"."]);
        }

        $saved[] = [
            'name' => sanitize(basename($original)),
            'size' => (int) $sizes[$i],
            'type' => $mime,
            'url'  => "uploads/$ticketNum/$safeName",
        ];
    }

    return $saved;
}
