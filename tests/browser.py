"""Run after npm run build and node tests/helpers/serve.mjs.
Uses fake Supabase upstream responses; no real accounts or credentials.
"""
import base64
import json
import time
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright, expect

BASE = 'http://127.0.0.1:4173'
USER = {'id': '10000000-0000-4000-8000-000000000001', 'aud': 'authenticated', 'role': 'authenticated', 'email': 'test@example.invalid', 'is_anonymous': False, 'user_metadata': {'full_name': 'Test User'}, 'created_at': '2026-01-01T00:00:00Z'}
def token(role):
    part = lambda value: base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip('=')
    return part({'alg': 'HS256', 'typ': 'JWT'}) + '.' + part({'sub': USER['id'], 'role': 'authenticated', 'test_role': role, 'exp': int(time.time()) + 3600}) + '.test-signature'

def setup(browser, role='peserta', fail=False):
    context = browser.new_context()
    errors = []
    context.on('page', lambda page: page.on('pageerror', lambda error: errors.append(str(error))))
    def upstream(route):
        request = route.request
        path = urlparse(request.url).path
        if path.endswith('/authorize'):
            redirect = parse_qs(urlparse(request.url).query)['redirect_to'][0]
            assert redirect.startswith(BASE + '/'), redirect
            route.fulfill(status=302, headers={'Location': redirect + ('&' if '?' in redirect else '?') + 'code=test-code'})
        elif path.endswith('/token'):
            assert json.loads(request.post_data)['code_verifier'], 'PKCE verifier required'
            if fail:
                route.fulfill(status=400, json={'error_code': 'bad_code_verifier', 'msg': 'Invalid code'})
            else:
                route.fulfill(json={'access_token': token(role), 'refresh_token': 'test-refresh', 'expires_in': 3600, 'token_type': 'bearer', 'user': USER})
        elif path.endswith('/user'):
            route.fulfill(json=USER)
        elif path.endswith('/logout'):
            route.fulfill(status=204)
        elif '/rest/v1/' in path:
            route.fulfill(json=[])
        else:
            route.fulfill(status=404, json={'message': 'Unexpected test request'})
    context.route('https://example.supabase.co/**', upstream)
    return context, errors

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
    # Anonymous visitors cannot open server-protected pages.
    context, errors = setup(browser)
    page = context.new_page()
    page.goto(BASE + '/kelas-saya')
    expect(page).to_have_url(BASE + '/login')
    expect(page.get_by_role('heading', name='Masuk dengan Google')).to_be_visible()
    assert context.request.get(BASE + '/api/session').status == 401
    print('PASS anonymous visitor: protected route redirects and session API returns 401')
    # Complete actual browser PKCE exchange, cookie write and backend verification.
    page.get_by_role('button', name='Masuk dengan Google', exact=False).last.click()
    expect(page).to_have_url(BASE + '/kelas-saya')
    expect(page.get_by_role('heading', name='Kelas Saya')).to_be_visible()
    response = context.request.get(BASE + '/api/session')
    assert response.status == 200 and response.json()['role'] == 'peserta'
    assert 'no-store' in response.headers['cache-control']
    print('PASS participant: PKCE callback -> cookies -> real session endpoint -> protected page')
    denied = context.request.get(BASE + '/admin', max_redirects=0)
    assert denied.status == 307 and denied.headers['location'] == '/admin/login?error_code=admin_required'
    page.goto(BASE + '/admin')
    expect(page).to_have_url(BASE + '/admin/login')
    expect(page.get_by_role('alert')).to_contain_text('belum diberi akses administrator')
    print('PASS participant cannot access administrator page')
    page.get_by_role('button', name='Keluar', exact=True).click()
    expect(page).to_have_url(BASE + '/')
    assert context.request.get(BASE + '/api/session').status == 401
    assert not errors, errors
    context.close()
    print('PASS logout clears browser and server authentication')
    # Administrator role is obtained through the real backend role lookup.
    context, errors = setup(browser, role='admin')
    page = context.new_page()
    page.goto(BASE + '/admin/login')
    page.get_by_role('button', name='Masuk sebagai Admin dengan Google', exact=False).click()
    expect(page).to_have_url(BASE + '/admin')
    expect(page.get_by_role('heading', name='Kelola Guru Creator Academy')).to_be_visible()
    assert context.request.get(BASE + '/api/session').json()['role'] == 'admin'
    assert not errors, errors
    context.close()
    print('PASS administrator: PKCE callback -> database role -> administrator page')
    # Invalid OAuth codes remain on the login page with an actionable message.
    context, errors = setup(browser, fail=True)
    page = context.new_page()
    page.goto(BASE + '/login')
    page.get_by_role('button', name='Masuk dengan Google', exact=False).last.click()
    expect(page.get_by_role('alert')).to_contain_text('Kode login Google tidak dapat dipakai')
    assert context.request.get(BASE + '/api/session').status == 401
    assert not errors, errors
    context.close()
    print('PASS invalid callback: visible error, no authenticated session')
    context, errors = setup(browser)
    context.route(BASE + '/api/session', lambda route: route.fulfill(status=503, json={'message': 'Database sedang tidak tersedia'}))
    page = context.new_page()
    page.goto(BASE + '/login')
    expect(page.get_by_role('heading', name='🔧 Koneksi belum dapat diverifikasi')).to_be_visible()
    expect(page.get_by_role('button', name='Coba lagi')).to_be_visible()
    assert page.get_by_role('button', name='Keluar', exact=True).count() == 0
    context.unroute(BASE + '/api/session')
    page.get_by_role('button', name='Coba lagi').click()
    expect(page.get_by_role('heading', name='Masuk dengan Google')).to_be_visible()
    assert not errors, errors
    context.close()
    print('PASS unavailable backend: private state hidden, retry recovers login page')
    browser.close()
