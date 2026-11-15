package br.com.alocca.plantoes

import org.json.JSONObject
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AuthMobileContractTest {
    @Test fun `unified login preserves PIN challenge for unknown device`() {
        val body = JSONObject().put("challenge_token", "opaque").put("requer_2fa", true).put("expires_in", 300)
        assertTrue(AuthApi.interpretarLoginMobile(ApiResult(true, body, "", 200)).successful)
    }

    @Test fun `trusted device flag alone cannot replace a valid session`() {
        val body = JSONObject().put("requer_2fa", false)
        assertFalse(AuthApi.interpretarLoginMobile(ApiResult(true, body, "", 200)).successful)
        assertFalse(AuthApi.interpretarLoginMobile(ApiResult(false, body, "unauthorized", 401)).successful)
    }
    @Test fun `challenge requires opaque token 2fa and lifetime and no session`() {
        val valid = JSONObject().put("challenge_token", "opaque").put("requer_2fa", true).put("expires_in", 300)
        fun interpret(body: JSONObject) = AuthApi.interpretarChallenge(ApiResult(true, body, "", 200)).successful
        assertTrue(interpret(valid))
        assertFalse(interpret(JSONObject(valid.toString()).put("requer_2fa", false)))
        assertFalse(interpret(JSONObject(valid.toString()).put("expires_in", 0)))
        assertFalse(interpret(JSONObject(valid.toString()).put("access_token", "premature")))
        assertFalse(interpret(JSONObject(valid.toString()).put("refresh_token", "premature")))
    }

    @Test fun `failed response remains a failure`() {
        val result = AuthApi.interpretarChallenge(ApiResult(false, null, "offline", 0))
        assertFalse(result.successful)
        assertTrue(result.message == "offline")
    }
}
