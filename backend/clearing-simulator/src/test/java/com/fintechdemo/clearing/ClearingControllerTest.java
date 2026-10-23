package com.fintechdemo.clearing;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest
@AutoConfigureMockMvc
class ClearingControllerTest {

    @Autowired
    MockMvc mvc;

    @BeforeEach
    void reset() throws Exception {
        mvc.perform(post("/simulator/reset")).andExpect(status().isOk());
    }

    private String body(String ref, String amount) {
        return "{\"reference\":\"" + ref + "\",\"amount\":\"" + amount + "\",\"currency\":\"USD\"}";
    }

    @Test
    void authorizesNormalAmountsAndIsIdempotentPerReference() throws Exception {
        for (int i = 0; i < 2; i++) {
            mvc.perform(post("/clearing/v1/authorizations").contentType(MediaType.APPLICATION_JSON).content(body("TXN-A", "100.00")))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.status").value("AUTHORIZED"))
                    .andExpect(jsonPath("$.authorizationId").value("AUTH-TXN-A"));
        }
        mvc.perform(get("/simulator/state")).andExpect(jsonPath("$.authorizations").value(1));
    }

    @Test
    void declinesAmountsEndingIn13Cents() throws Exception {
        mvc.perform(post("/clearing/v1/authorizations").contentType(MediaType.APPLICATION_JSON).content(body("TXN-D", "10.13")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("DECLINED"))
                .andExpect(jsonPath("$.reasonCode").value("RISK_DECLINE"));
    }

    @Test
    void failsTwiceThenSucceedsForAmountsEndingIn99Cents() throws Exception {
        for (int i = 0; i < 2; i++) {
            mvc.perform(post("/clearing/v1/authorizations").contentType(MediaType.APPLICATION_JSON).content(body("TXN-T", "5.99")))
                    .andExpect(status().isServiceUnavailable());
        }
        mvc.perform(post("/clearing/v1/authorizations").contentType(MediaType.APPLICATION_JSON).content(body("TXN-T", "5.99")))
                .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("AUTHORIZED"));
    }

    @Test
    void lookupReturns404ForUnknownReferenceAndTheRecordedResultOtherwise() throws Exception {
        mvc.perform(get("/clearing/v1/authorizations/TXN-NONE")).andExpect(status().isNotFound());
        mvc.perform(post("/clearing/v1/authorizations").contentType(MediaType.APPLICATION_JSON).content(body("TXN-L", "20.00")))
                .andExpect(status().isOk());
        mvc.perform(get("/clearing/v1/authorizations/TXN-L")).andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("AUTHORIZED"));
    }

    @Test
    void chaosModeForcesServerErrors() throws Exception {
        mvc.perform(post("/simulator/chaos").contentType(MediaType.APPLICATION_JSON).content("{\"mode\":\"FAIL_5XX\"}"))
                .andExpect(status().isOk());
        mvc.perform(post("/clearing/v1/authorizations").contentType(MediaType.APPLICATION_JSON).content(body("TXN-C", "1.00")))
                .andExpect(status().isServiceUnavailable());
    }

    @Test
    void rejectsMalformedRequests() throws Exception {
        mvc.perform(post("/clearing/v1/authorizations").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reference\":\"\",\"amount\":\"abc\",\"currency\":\"usd\"}"))
                .andExpect(status().isBadRequest());
    }
}
