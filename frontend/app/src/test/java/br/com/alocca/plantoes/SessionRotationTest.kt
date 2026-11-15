package br.com.alocca.plantoes

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference

class SessionRotationTest {
    private val old = TokenStore.Session("old", "refresh-old", 1, 2)
    private val next = TokenStore.Session("new", "refresh-new", 3, 4)

    @Test fun concurrentRequestsRotateOnce() {
        val store = AtomicReference<TokenStore.Session?>(old)
        val calls = AtomicInteger()
        val rotation = SessionRotation()
        val pool = Executors.newFixedThreadPool(8)
        val futures = (1..8).map { pool.submit<SessionManager.RefreshResult> {
            rotation.refresh("old", { store.get() }, { calls.incrementAndGet(); ApiResult(true, JSONObject(), "", 200) },
                { a, b -> store.compareAndSet(a, b) }, { store.compareAndSet(it, null) }, { next })
        } }
        futures.forEach { assertEquals("new", it.get(5, TimeUnit.SECONDS).access) }
        assertEquals(1, calls.get())
        pool.shutdownNow()
    }

    @Test fun failuresAndLogoutDoNotRestoreCredentials() {
        val store = AtomicReference<TokenStore.Session?>(old)
        val rotation = SessionRotation()
        fun run(status: Int) = rotation.refresh("old", { store.get() }, { ApiResult(false, null, "", status) },
            { a, b -> store.compareAndSet(a, b) }, { store.compareAndSet(it, null) }, { next })
        assertEquals(0, run(0).status)
        assertEquals(503, run(503).status)
        assertEquals(old, store.get())
        assertEquals(401, run(401).status)
        assertNull(store.get())
        store.set(old)
        val result = rotation.refresh("old", { store.get() }, { store.set(null); ApiResult(true, JSONObject(), "", 200) },
            { a, b -> store.compareAndSet(a, b) }, { store.compareAndSet(it, null) }, { next })
        assertNull(result.access)
        assertNull(store.get())
    }
}
